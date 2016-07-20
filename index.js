//var spawn = require('child_process').spawn;
var request = require("request");
var mdns = require('mdns');
var inherits = require('util').inherits;
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    fixInheritance(mcuiot.Moisture, Characteristic);

    homebridge.registerPlatform("homebridge-mcuiot", "mcuiot", mcuiot, true);
}

function fixInheritance(subclass, superclass) {
    var proto = subclass.prototype;
    inherits(subclass, superclass);
    subclass.prototype.parent = superclass.prototype;
    for (var mn in proto) {
        subclass.prototype[mn] = proto[mn];
    }
}

function handleError(error) {
    switch (error.errorCode) {
        case mdns.kDNSServiceErr_Unknown:
            console.warn(error);
            setTimeout(createBrowser, 5000);
            break;
        default:
            console.warn(error);
            //throw error;
    }
}

function mcuiot(log, config, api) {
    var self = this;

    self.log = log;
    self.config = config || {
        "platform": "mcuiot"
    };

    self.timeout = self.config.timeout || 15000;

    self.accessories = {}; // MAC -> Accessory


    if (api) {
        self.api = api;
        self.api.on('didFinishLaunching', self.didFinishLaunching.bind(this));
    }
}

mcuiot.prototype.configureAccessory = function(accessory) {
    var self = this;

    accessory.reachable = true;
    this.log("configureAccessory %s", accessory.displayName);

    accessory.getService(Service.TemperatureSensor)
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', this.getDHTTemperature.bind(this));

    var name = accessory.displayName;
    self.accessories[name] = accessory;
}

mcuiot.prototype.didFinishLaunching = function() {
    var self = this;

    this.log("Starting mDNS listener");
    try {

        var sequence = [
            mdns.rst.DNSServiceResolve(),
            'DNSServiceGetAddrInfo' in mdns.dns_sd ? mdns.rst.DNSServiceGetAddrInfo() : mdns.rst.getaddrinfo({
                families: [4]
            }),
            mdns.rst.makeAddressesUnique()
        ];
        var browser = mdns.createBrowser(mdns.tcp('dht22'), {
            resolverSequence: sequence
        });
        browser.on('serviceUp', function(service) {
            //        console.log("service up: ", service);
            self.log("Found url http://%s:%s/", service.host, service.port);
            self.addMcuAccessory(service);
        });
        browser.on('serviceDown', function(service) {
            self.log("service down: ", service);
            self.removeAccessory(service.name);
        });
        browser.on('error', handleError);
        browser.start();
    } catch (ex) {
        handleError(ex);
    }

}


mcuiot.prototype.dashEventWithAccessory = function(self, accessory) {
    var targetChar = accessory
        .getService(Service.StatelessProgrammableSwitch)
        .getCharacteristic(Characteristic.ProgrammableSwitchEvent);

    targetChar.setValue(1);
    setTimeout(function() {
        targetChar.setValue(0);
    }, self.timeout);
}


mcuiot.prototype.getDHTTemperature = function(callback) {
    var self = this;

    if (!this.url) {
        this.log.warn("Ignoring request; No url defined.");
        callback(new Error("No url defined."));
        return;
    }

    //    this.log("Object: %s", JSON.stringify(this, null, 4));

    var url = this.url;
    var name = this.name;
    this.log("Reading DHT %s", url);

    this.httpRequest(url, "", "GET", function(error, response, responseBody) {
        if (error) {
            this.log('HTTP get failed: %s', error.message);
            callback(error);
        } else {
            var response = JSON.parse(responseBody);

            this.log("DHT Response %s", JSON.stringify(response, null, 4));
            self.accessories[name].getService(Service.TemperatureSensor)
                .setCharacteristic(Characteristic.CurrentRelativeHumidity, parseFloat(response.Data.Humidity));

            if (response.Model == "DHT-YL") {
                var moist = (1024 - parseFloat(response.Data.Moisture)) / 10.2;
                self.accessories[name].getService(Service.TemperatureSensor)
                    .setCharacteristic("Moisture", parseFloat(moist));
            }

            callback(null, parseFloat(response.Data.Temperature));
        }
    }.bind(this));
}

mcuiot.prototype.mcuModel = function(url) {
    var self = this;
    var model;
    //    this.log("Object: %s", JSON.stringify(this, null, 4));

    this.log("Reading DHT Model %s", url);

    this.httpRequest(url, "", "GET", function(error, response, responseBody) {
        if (error) {
            this.log('HTTP get failed: %s', error.message);
            callback(error);
        } else {
            var response = JSON.parse(responseBody);

            this.log("DHT Response %s", response.Hostname, response.Model, response.Version);

            model = response.Model;

            return model;
        }
    }.bind(this));


}

mcuiot.prototype.addMcuAccessory = function(device) {
    var self = this;
    var name = device.name;
    var host = device.host;
    var port = device.port;
    var url = "http://" + host + ":" + port + "/";
    self.url = url;
    self.name = name;
    var uuid = UUIDGen.generate(name);

    if (!this.accessories[name]) {
        this.log("addMcuAccessory %s", name);
        var newAccessory = new Accessory(name, uuid, 10);

        var model = self.mcuModel(url);
this.log("addMcuAccessory %s", name,model);
        newAccessory.reachable = true;
        newAccessory.context.model = model;
        //        newAccessory.context.name = name;

        newAccessory.addService(Service.TemperatureSensor, name)
            .getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getDHTTemperature.bind(self));

        newAccessory
            .getService(Service.TemperatureSensor)
            .addCharacteristic(Characteristic.CurrentRelativeHumidity);

        if (model == "DHT-YL") {

            newAccessory
                .getService(Service.TemperatureSensor)
                .addCharacteristic(mcuiot.Moisture);

        }

        newAccessory
            .getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, "Expressiv")
            .setCharacteristic(Characteristic.Model, model)
            .setCharacteristic(Characteristic.SerialNumber, url);

        this.accessories[name] = newAccessory;
        this.api.registerPlatformAccessories("homebridge-mcuiot", "mcuiot", [newAccessory]);
    } else {
        this.log("Skipping %s", name);
    }
}



mcuiot.prototype.removeAccessory = function(name) {
    this.log("removeAccessory %s", name);
    if (this.accessories[name]) {
        accessory = this.accessories[name];
        this.api.unregisterPlatformAccessories("homebridge-mcuiot", "mcuiot", [accessory]);
        delete this.accessories[name];
        this.log("removedAccessory %s", name);
    }
}

mcuiot.Moisture = function() {
    Characteristic.call(this, 'Moisture', '00002001-0000-1000-8000-135D67EC4377');
    this.setProps({
        format: Characteristic.Formats.UINT8,
        unit: Characteristic.Units.PERCENTAGE,
        maxValue: 100,
        minValue: 0,
        minStep: 1,
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    });
    this.value = this.getDefaultValue();
};

mcuiot.prototype.httpRequest = function(url, body, method, callback) {
    request({
            url: url,
            body: body,
            method: method,
            rejectUnauthorized: false,
            timeout: 10000

        },
        function(error, response, body) {
            callback(error, response, body)
        })
}

//removed the ARP configuration method. config.json will need to be filled in manually.
//TODO: add a method to discover the MAC of a specific button and re-implement this function.
mcuiot.prototype.configurationRequestHandler = function(context, request, callback) {

    this.log("configurationRequestHandler");

}
