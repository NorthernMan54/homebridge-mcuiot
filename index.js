// Homebridge platform plugin supporting the display of temperature, humidity and
// soil moisture from ESP8266/Nodemcu devices connected to DHT22 and YL-69 sensors.
// Build instructions for the sensor are in this github project
// https://github.com/NorthernMan54/nodemcu-dht-yl69-json-mdns
//
// Supports automatic device discovery using mDNS
//
// Remember to add platform to config.json. Example:
//
// "platforms": [{
//    "platform": "mcuiot"
// }],

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

// Set mDNS timeout to 5 seconds

function handleError(error) {
    switch (error.errorCode) {
        case mdns.kDNSServiceErr_Unknown:
            console.warn(error);
            setTimeout(createBrowser, 5000);
            break;
        default:
            console.warn(error);
    }
}

function mcuiot(log, config, api) {
    var self = this;

    self.log = log;
    self.config = config || {
        "platform": "mcuiot"
    };

    self.accessories = {}; // MAC -> Accessory

    if (api) {
        self.api = api;
        self.api.on('didFinishLaunching', self.didFinishLaunching.bind(self));
    }
}

mcuiot.prototype.configureAccessory = function(accessory) {
    var self = this;

    accessory.reachable = true;
    self.log("configureAccessory %s", accessory.displayName);

    accessory.on('identify', self.Identify.bind(self, accessory));

    accessory.getService(Service.TemperatureSensor)
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', self.getDHTTemperature.bind(self, accessory));

    var name = accessory.displayName;
    self.accessories[name] = accessory;
}

mcuiot.prototype.didFinishLaunching = function() {
    var self = this;

    self.log("Starting mDNS listener");
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

            self.log("Found url http://%s:%s/", service.host, service.port);
            var url = "http://" + service.host + ":" + service.port + "/";
            mcuiot.prototype.mcuModel(url, function(model) {
                self.addMcuAccessory(service, model);
            })

        });
        browser.on('serviceDown', function(service) {
            self.log("Service down: ", service);
            // Mark missing devices as unreachable
            self.deviceDown(service.name);
        });
        browser.on('error', handleError);
        browser.start();
    } catch (ex) {
        handleError(ex);
    }

}

// Am using the Identify function to validate a device, and if it doesn't respond
// remove it from the config

mcuiot.prototype.Identify = function(accessory, status, callback) {

    var self = this;

    //  self.log("Object: %s", JSON.stringify(accessory, null, 4));

    self.log("Identify Request %s", accessory.displayName);

    self.httpRequest(accessory.context.url, "", "GET", function(error, response, responseBody) {
        if (error) {
            self.log('HTTP get failed: %s', error.message);
            self.log("Identify failed %s", accessory.displayName);
            self.removeAccessory(accessory.displayName);
            callback(error);
        } else {
            self.log("Identify successful %s", accessory.displayName);
            callback();
        }
    }.bind(self));

}

mcuiot.prototype.getDHTTemperature = function(accessory, callback) {
    var self = this;

    if (!self.url) {
        self.log.warn("Ignoring request; No url defined.");
        callback(new Error("No url defined."));
        return;
    }

    //    self.log("Object: %s", JSON.stringify(accessory, null, 4));

    var url = accessory.context.url;
    var name = accessory.displayName;
    self.log("Reading MCUIOT %s", name);

    self.httpRequest(url, "", "GET", function(error, response, responseBody) {
        if (error) {
            self.log('HTTP get failed: %s', error.message);
            //self.removeAccessory(name);
            callback(new Error(error));
        } else {
            var response = JSON.parse(responseBody);
            self.log("MCUIOT Response %s", JSON.stringify(response, null, 4));
            if (parseInt(response.Data.Status) != 0) {
                self.log("Error status %s", parseInt(response.Data.Status));
                callback(new Error("Nodemcu returned error"));
            } else {

                self.accessories[name].getService(Service.TemperatureSensor)
                    .setCharacteristic(Characteristic.CurrentRelativeHumidity, parseFloat(response.Data.Humidity));

                if (response.Model == "DHT-YL") {
                    var moist = (1024 - parseFloat(response.Data.Moisture)) / 10.2;
                    self.accessories[name].getService(Service.TemperatureSensor)
                        .setCharacteristic("Moisture", parseFloat(moist));
                }

                callback(null, parseFloat(response.Data.Temperature));
            }
        }
    }.bind(self));
}

mcuiot.prototype.mcuModel = function(url, callback) {
    var self = this;
    var model;
    //    this.log("Object: %s", JSON.stringify(this, null, 4));

    self.httpRequest(url, "", "GET", function(error, response, responseBody) {
        if (error) {
            console.log('HTTP get failed: %s', error.message);
            callback(error);
        } else {
            var response = JSON.parse(responseBody);

            model = response.Model;
            callback(model);
        }
    }.bind(self));


}

mcuiot.prototype.addMcuAccessory = function(device, model) {
    var self = this;
    var name = device.name;
    var host = device.host;
    var port = device.port;
    var url = "http://" + host + ":" + port + "/";
    self.url = url;
    self.name = name;
    var uuid = UUIDGen.generate(name);

    if (!self.accessories[name]) {
        var accessory = new Accessory(name, uuid, 10);

        self.log("addMcuAccessory 195 %s", name, model);
        accessory.reachable = true;
        accessory.context.model = model;
        accessory.context.url = url;

        accessory.addService(Service.TemperatureSensor, name)
            .getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({
                minValue: -100,
                maxValue: 100
            })
            .on('get', self.getDHTTemperature.bind(self, accessory));

        accessory
            .getService(Service.TemperatureSensor)
            .addCharacteristic(Characteristic.CurrentRelativeHumidity);

        if (model == "DHT-YL") {

            accessory
                .getService(Service.TemperatureSensor)
                .addCharacteristic(mcuiot.Moisture);

        }

        accessory
            .getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, "Expressiv")
            .setCharacteristic(Characteristic.Model, model + " " + name)
            .setCharacteristic(Characteristic.SerialNumber, url);

        accessory.on('identify', self.Identify.bind(self, accessory));

        self.accessories[name] = accessory;
        self.api.registerPlatformAccessories("homebridge-mcuiot", "mcuiot", [accessory]);
    } else {
        self.log("Skipping %s", name);
        accessory = this.accessories[name];
        accessory.updateReachability(true);
    }
}

// Mark down accessories as unreachable

mcuiot.prototype.deviceDown = function(name) {
    var self = this;
    if (self.accessories[name]) {
        accessory = this.accessories[name];
        self.mcuModel(accessory.context.url, function(model) {
            accessory.updateReachability(false);
        })
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

// Set http request timeout to 10 seconds

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

mcuiot.prototype.configurationRequestHandler = function(context, request, callback) {

    this.log("configurationRequestHandler");

}
