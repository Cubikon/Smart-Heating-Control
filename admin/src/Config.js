// Räume laden
function loadRooms(adapterConfig) {
    const tbody = $('#roomsTable tbody');
    tbody.empty();
    (adapterConfig.rooms || []).forEach((r,i) => {
        const row = $('<tr>').append(
            `<td><input type="text" class="form-control name" value="${r.name}"></td>`,
            `<td><input type="text" class="form-control sensor" value="${r.sensor}"></td>`,
            `<td><input type="text" class="form-control targetSensor" value="${r.targetSensor}"></td>`,
            `<td><input type="text" class="form-control windowContact" value="${r.windowContact}"></td>`,
            `<td><input type="text" class="form-control ventilIds" value="${r.ventilIds.join(',')}"></td>`,
            `<td><input type="text" class="form-control matrixState" value="${r.matrixState}"></td>`,
            `<td><input type="number" class="form-control circuit" value="${r.circuit}"></td>`,
            `<td><button class="btn btn-danger deleteRoom">X</button></td>`
        );
        tbody.append(row);
    });
}

// Raum hinzufügen
$('#addRoom').click(() => {
    const tbody = $('#roomsTable tbody');
    const row = $('<tr>').append(
        `<td><input type="text" class="form-control name"></td>`,
        `<td><input type="text" class="form-control sensor"></td>`,
        `<td><input type="text" class="form-control targetSensor"></td>`,
        `<td><input type="text" class="form-control windowContact"></td>`,
        `<td><input type="text" class="form-control ventilIds"></td>`,
        `<td><input type="text" class="form-control matrixState"></td>`,
        `<td><input type="number" class="form-control circuit" value="0"></td>`,
        `<td><button class="btn btn-danger deleteRoom">X</button></td>`
    );
    tbody.append(row);
});

// Raum löschen
$('#roomsTable').on('click','.deleteRoom', function(){
    $(this).closest('tr').remove();
});

// Speichern in Adapter Config
function saveRooms(adapterConfig){
    const rooms = [];
    $('#roomsTable tbody tr').each(function(){
        const r = {
            name: $(this).find('.name').val(),
            sensor: $(this).find('.sensor').val(),
            targetSensor: $(this).find('.targetSensor').val(),
            windowContact: $(this).find('.windowContact').val(),
            ventilIds: $(this).find('.ventilIds').val().split(',').map(s=>s.trim()),
            matrixState: $(this).find('.matrixState').val(),
            circuit: parseInt($(this).find('.circuit').val(),10) || 0
        };
        rooms.push(r);
    });
    adapterConfig.rooms = rooms;

    // Circuits & Influx
    try { adapterConfig.circuits = JSON.parse($('#circuits').val()); } catch(e){}
    adapterConfig.influxEnabled = $('#influxEnabled').prop('checked');
    adapterConfig.influxMeasurement = $('#influxMeasurement').val();
}
