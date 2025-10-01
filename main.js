'use strict';
const utils = require('@iobroker/adapter-core');

const matrixDimensions = {
    temp:    { min: -20, max: 20, step: 2 },
    wind:    { min: 0, max: 20, step: 4 },
    windDir: { min: 0, max: 270, step: 90 },
    rain:    { min: 0, max: 1, step: 1 },
    target:  { min: 18, max: 22, step: 1 },
    demand:  { min: 0, max: 100, step: 33 }
};

class HeatingControl extends utils.Adapter {

    constructor(options) {
        super({ ...options, name: 'heatingcontrol' });

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));

        this.timer = null;
    }

    async onReady() {
        this.log.info('Heizungs-Adapter gestartet');

        this.rooms = this.config.rooms || [];
        this.circuits = this.config.circuits || {};
        this.flowMin = this.config.flowMin || 30;
        this.flowMax = this.config.flowMax || 65;
        this.influxEnabled = !!this.config.influxEnabled;
        this.influxMeasurement = this.config.influxMeasurement || 'heating';

        this.roomInertia = 0.5;
        this.circuitInertia = { 0: 0.5, 1: 0.3 };

        // Timer alle 5 Minuten
        this.timer = setInterval(() => this.controlHeating(), 5*60*1000);
        await this.controlHeating();
    }

    async onUnload(callback) {
        try {
            if (this.timer) clearInterval(this.timer);
            callback();
        } catch (e) {
            callback();
        }
    }

    async onStateChange(id, state) {
        // Optional: Fensterkontakt-Trigger
    }

    quantize(value, dim) {
        const { min, max, step } = matrixDimensions[dim];
        if (value < min) value = min;
        if (value > max) value = max;
        return Math.round((value - min) / step) * step + min;
    }

    buildKey(temp, wind, windDir, rain, target, demandPct) {
        return [
            this.quantize(temp, 'temp'),
            this.quantize(wind, 'wind'),
            this.quantize(windDir, 'windDir'),
            this.quantize(rain, 'rain'),
            this.quantize(target, 'target'),
            this.quantize(demandPct, 'demand')
        ].join("_");
    }

    async logToInflux(tags, fields) {
        if (!this.influxEnabled) return;
        this.sendTo('influxdb.0', 'store', {
            measurement: this.influxMeasurement,
            tags, fields,
            timestamp: Date.now()
        });
    }

    async updateMatrix(room, temp, wind, windDir, rain, target, flowDelivered, flowUsed) {
        let matrix = {};
        const state = (await this.getStateAsync(room.matrixState))?.val;
        if (state) matrix = JSON.parse(state);

        let prevFlow = (await this.getStateAsync(`${room.matrixState}_lastFlow`))?.val || flowUsed;
        const smoothedFlow = prevFlow*(1-this.roomInertia) + flowUsed*this.roomInertia;
        await this.setStateAsync(`${room.matrixState}_lastFlow`, smoothedFlow, true);

        const key = this.buildKey(temp, wind, windDir, rain, target, smoothedFlow);
        if (!matrix[key]) matrix[key] = smoothedFlow;
        else matrix[key] = 0.8*matrix[key] + 0.2*smoothedFlow;

        await this.setStateAsync(room.matrixState, JSON.stringify(matrix), true);

        await this.logToInflux({ room: room.name, target }, {
            temp: this.quantize(temp,'temp'),
            wind: this.quantize(wind,'wind'),
            windDir: this.quantize(windDir,'windDir'),
            demand: smoothedFlow
        });
    }

    interpolateFlow(matrix, temp, wind, windDir, rain, target) {
        const keyExact = this.buildKey(temp, wind, windDir, rain, target, 0);
        if(matrix[keyExact]) return matrix[keyExact];

        const neighbors = [];
        for (const k in matrix) {
            const [t,w,wd,r,s,d] = k.split('_').map(Number);
            if(Math.abs(t-temp)<=matrixDimensions.temp.step &&
               Math.abs(w-wind)<=matrixDimensions.wind.step &&
               Math.abs(wd-windDir)<=matrixDimensions.windDir.step &&
               Math.abs(r-rain)<=matrixDimensions.rain.step &&
               Math.abs(s-target)<=matrixDimensions.target.step){
                neighbors.push(matrix[k]);
            }
        }
        if(neighbors.length>0) return neighbors.reduce((a,b)=>a+b,0)/neighbors.length;
        return 40;
    }

    async getRequiredFlow() {
        const flowNeeded = {0:0,1:0};

        for (const r of this.rooms) {
            const matrix = JSON.parse((await this.getStateAsync(r.matrixState))?.val || '{}');
            const target = (await this.getStateAsync(r.targetSensor))?.val || 20;
            const returnTemp = (await this.getStateAsync(this.circuits[r.circuit].returnTemp))?.val || target;

            let flow = this.interpolateFlow(matrix, outsideTemp, windSpeed, windDirection, rain, target);

            // Rücklauf als Korrekturfaktor
            const desiredReturn = (r.circuit===0)? 35 : 40;
            flow *= 1 - 0.5*(desiredReturn - returnTemp)/desiredReturn;

            if(flow > flowNeeded[r.circuit]) flowNeeded[r.circuit] = flow;
        }

        return flowNeeded;
    }

    async controlHeating() {
        const outsideTemp = (await this.getStateAsync('hmip.0.devices.999.sensor.temperature'))?.val || 0;
        const windSpeed = (await this.getStateAsync('0_userdata.0.weather.windSpeed'))?.val || 0;
        const windDirection = (await this.getStateAsync('0_userdata.0.weather.windDirection'))?.val || 0;
        const rain = (await this.getStateAsync('0_userdata.0.weather.rain'))?.val || 0;

        const flowNeeded = await this.getRequiredFlow();

        for(const r of this.rooms) {
            const temp = (await this.getStateAsync(r.sensor))?.val || 20;
            const target = (await this.getStateAsync(r.targetSensor))?.val || 20;
            const windowOpen = (await this.getStateAsync(r.windowContact))?.val;

            let ventilSum = 0;
            for(const vid of r.ventilIds){
                let ventil = (await this.getStateAsync(vid))?.val || 50;
                let prevVent = (await this.getStateAsync(`${vid}_lastVent`))?.val || ventil;

                if(windowOpen) ventil = 0;
                else {
                    const desiredReturn = (r.circuit===0)? 35:40;
                    const deficit = (target-temp)+0.5*(desiredReturn - (await this.getStateAsync(this.circuits[r.circuit].returnTemp))?.val||target);

                    if(deficit>0.5) ventil +=2;
                    if(deficit<-0.5) ventil -=2;
                    ventil = Math.min(100, Math.max(0, ventil));
                }

                ventil = prevVent*(1-this.roomInertia)+ventil*this.roomInertia;
                await this.setStateAsync(`${vid}_lastVent`, ventil, true);
                await this.setStateAsync(vid, ventil, true);
                ventilSum += ventil;

                await this.logToInflux({ room: r.name, ventil: vid }, { ventil: ventil });
            }

            const avgVentil = ventilSum/r.ventilIds.length;
            const flowDelivered = (await this.getStateAsync(this.circuits[r.circuit].tempMax))?.val || 40;
            const roomFlowUsed = flowDelivered*(avgVentil/100);

            await this.updateMatrix(r, outsideTemp, windSpeed, windDirection, rain, target, flowDelivered, roomFlowUsed);
            await this.logToInflux({ room: r.name }, { demand: roomFlowUsed, temp: temp, target: target });
        }

        // Vorlauf pro Kreis setzen
        for(const c of [0,1]){
            const prevFlow = (await this.getStateAsync(this.circuits[c].tempMax))?.val || flowNeeded[c];
            const smoothedFlow = prevFlow*(1-this.circuitInertia[c])+flowNeeded[c]*this.circuitInertia[c];

            await this.setStateAsync(this.circuits[c].tempMin, smoothedFlow, true);
            await this.setStateAsync(this.circuits[c].tempMax, smoothedFlow, true);
        }
    }
}

if (require.main !== module) {
    module.exports = (options) => new HeatingControl(options);
} else {
    new HeatingControl();
}
