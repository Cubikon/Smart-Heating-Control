"use strict";
const utils = require("@iobroker/adapter-core");

// Adapter simuliert starten
const adapter = utils.Adapter("heatingcontrol");

adapter.on("ready", () => {
    adapter.log.info("Adapter startet (Dummy-Test)!");
    
    // Dummy-Matrix
    const rooms = [{ name: "Wohnzimmer", sensor: 21 }];
    rooms.forEach(r => adapter.log.info(`Raum: ${r.name}, Temp: ${r.sensor}`));
    
    // Stoppen nach Test
    adapter.stop();
});