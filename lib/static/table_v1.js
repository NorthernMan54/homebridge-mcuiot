$('document').ready(function() {

    $.ajax({
        url: '/devices.js',
        dataType: 'application/json',
        complete: function(response) {
            devices = JSON.parse(response.responseText);

            var headerRow = $("<tr><th>Name</th><th>Model</th><th>Version</th><th>"
            +"Firmware</th><th>Temperature</th><th>Humidity</th><th>Barometer</th></tr>");
            $("#myData").append(headerRow);
            $.each(devices, function(index, device) {

                $.ajax({
                    type: 'GET',
                    url: device.url,
                    timeout: 2000,

                    success: function(data) {
                        var row = $("<tr><td>" + data.Hostname + "</td><td>" + data.Model +
                            "</td><td>" + data.Version + "</td><td>" + data.Firmware + "</td><td>" +
                            data.Data.Temperature + "</td><td>" + data.Data.Humidity + "</td><td>" +
                            data.Data.Barometer + "</td></tr>");
                        $("#myData").append(row);

                    },
                    error: function(jqXHR, textStatus, errorThrown) {
                        var row = $("<tr><td>" + device.name + "</td><td> Error </td><td>" + textStatus + "</td><td>" + errorThrown + "</td></tr>");
                        $("#myData").append(row);

                    }
                });

            });
            return false; //suppress natural form submission

        },
        success: function(response) {
            alert(response)
        }
    });

    return false; //suppress natural form submission
});
