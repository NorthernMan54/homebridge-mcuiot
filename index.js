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
//    "platform": "mcuiot",
//    "name": "MCUIOT",
//    "debug":    "True", // Optional enables debug output - noisy
//    "refresh":  "60",   // Optional, device refresh time
//    "leak":     "10"    // Optional, moisture level to trigger a leak alert
// }],

var request = require("request");
var mdns = require('mdns');
var inherits = require('util').inherits;
var Accessory, Service, Characteristic, UUIDGen, CommunityTypes;
var web = require('./lib/web.js');

module.exports = function(homebridge) {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    CommunityTypes = require('hap-nodejs-community-types')(homebridge)

    fixInheritance(mcuiot.Moisture, Characteristic);

    homebridge.registerPlatform("homebridge-mcuiot", "mcuiot", mcuiot);
}

function mcuiot(log, config, api) {
    this.log = log;
    this.config = config;

    this.debug = config['debug'] || false;
    this.refresh = config['refresh'] || 60; // Update every minute
    this.leak = config['leak'] || 10; // Leak detected threshold
    this.port = config['port'] || 8080; // Default http port

    if ( this.debug )
      this.log("Settings: refresh=%s, leak=%s",this.refresh,this.leak);

    this.accessories = {}; // MAC -> Accessory

    if (api) {
        this.api = api;
        this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
    }
}

mcuiot.prototype.configureAccessory = function(accessory) {
    var self = this;

    accessory.reachable = true;
    self.log("configureAccessory %s", accessory.displayName);

    accessory.on('identify', self.Identify.bind(self, accessory));

    if (accessory.getService(Service.TemperatureSensor))
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

            self.log("Found MCUIOT device:", service.name);
            mcuiot.prototype.mcuModel("http://" + service.host + ":" + service.port + "/", function(err, model) {
                if (!err)
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

    setInterval(this.devicePolling.bind(this), this.refresh * 1000);

    var server = web.init(this.log,this.port,this.accessories);

}

mcuiot.prototype.devicePolling = function() {
    for (var id in this.accessories) {
        var device = this.accessories[id];
        if (device.reachable) {
            if (this.debug)
                this.log("Poll:", id);
            if (this.accessories[id].getService(Service.TemperatureSensor))
                this.accessories[id].getService(Service.TemperatureSensor)
                .getCharacteristic(Characteristic.CurrentTemperature)
                .getValue();

        }
    }
}

// Am using the Identify function to validate a device, and if it doesn't respond
// remove it from the config

mcuiot.prototype.Identify = function(accessory, status, callback) {

    var self = this;

    //  self.log("Object: %s", JSON.stringify(accessory, null, 4));

    self.log("Identify Request %s", accessory.displayName);

    httpRequest(accessory.context.url, "", "GET", function(err, response, responseBody) {
        if (err) {
            self.log('HTTP get failed: %s', err.message);
            self.log("Identify failed %s", accessory.displayName);
            self.removeAccessory(accessory.displayName);
            callback(err);
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
    self.log("Reading MCUIOT:", name);

    httpRequest(url, "", "GET", function(err, response, responseBody) {
        if (err) {
            self.log('HTTP get failed: %s', err.message);
            //self.removeAccessory(name);
            callback(err);
        } else {
            var response = JSON.parse(responseBody);
            if (self.debug) self.log("MCUIOT Response %s", JSON.stringify(response, null, 4));
            if (roundInt(response.Data.Status) != 0) {
                self.log("Error status %s", roundInt(response.Data.Status));
                callback(new Error("Nodemcu returned error"));
            } else {

                self.accessories[name].getService(Service.TemperatureSensor)
                    .setCharacteristic(Characteristic.CurrentRelativeHumidity, roundInt(response.Data.Humidity));

                if (response.Model.endsWith("YL")) {
                    // Set moisture level for YL Models
                    var moist = (1024 - roundInt(response.Data.Moisture)) / 10.2;
                    self.accessories[name].getService(Service.TemperatureSensor)
                        .setCharacteristic("Moisture", roundInt(moist));
                    // Do we have a leak ?
                    if( this.debug )
                          this.log("Leak: %s > %s ?",moist,this.leak);
                    if (moist > this.leak ) {
                      if( this.debug )
                        this.log("Leak");
                        self.accessories[name].getService(Service.TemperatureSensor)
                            .setCharacteristic(Characteristic.LeakDetected, Characteristic.LeakDetected.LEAK_DETECTED);
                        self.accessories[name + "LS"].getService(Service.LeakSensor)
                            .setCharacteristic(Characteristic.LeakDetected, Characteristic.LeakDetected.LEAK_DETECTED);

                    } else {
                      if( this.debug )
                        this.log("No Leak");
                        self.accessories[name].getService(Service.TemperatureSensor)
                            .setCharacteristic(Characteristic.LeakDetected, Characteristic.LeakDetected.LEAK_NOT_DETECTED);
                        self.accessories[name + "LS"].getService(Service.LeakSensor)
                            .setCharacteristic(Characteristic.LeakDetected, Characteristic.LeakDetected.LEAK_NOT_DETECTED);
                    }
                }
                if (response.Model.startsWith("BME")) {
                    // Set BME280 Atmospheric pressure sensor;
                    self.accessories[name].getService(Service.TemperatureSensor)
                        .setCharacteristic(CommunityTypes.AtmosphericPressureLevel, roundInt(response.Data.Barometer));
                }

                callback(null, roundInt(response.Data.Temperature));
            }
        }
    }.bind(self));
}

mcuiot.prototype.mcuModel = function(url, callback) {
    var self = this;
    var model;
    //    this.log("Object: %s", JSON.stringify(this, null, 4));

    httpRequest(url, "", "GET", function(err, response, responseBody) {
        if (err) {
            console.log('HTTP get failed: %s', err.message);
            callback(err);
        } else {
            var response = JSON.parse(responseBody);
            callback(null, response.Model);
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

        self.log("Adding MCUIOT Device:", name, model);
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

        if (model.endsWith("YL")) {
            // Add YL-69 Moisture sensor
            accessory
                .getService(Service.TemperatureSensor)
                .addCharacteristic(mcuiot.Moisture);
            accessory
                .getService(Service.TemperatureSensor)
                .addCharacteristic(Characteristic.LeakDetected);

            this.addLeakSensor(device, model);
        }
        if (model.startsWith("BME")) {
            // Add BME280 Atmospheric pressure sensor;
            this.log("Adding BME", name);
            accessory
                .getService(Service.TemperatureSensor)
                .addCharacteristic(CommunityTypes.AtmosphericPressureLevel);
        }

        accessory
            .getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, "MCUIOT")
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

mcuiot.prototype.addLeakSensor = function(device, model) {
    var self = this;
    var name = device.name + "LS";

    var url = "http://" + device.host + ":" + device.port + "/";
    //    self.url = url;
    //    self.name = name;
    var uuid = UUIDGen.generate(name);

    if (!self.accessories[name]) {
        var accessory = new Accessory(name, uuid, 10);

        self.log("Adding MCUIOT-LS Device:", name, model);
        accessory.reachable = true;
        accessory.context.model = model;
        accessory.context.url = url;

        accessory.addService(Service.LeakSensor, name);

        accessory
            .getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, "MCUIOT")
            .setCharacteristic(Characteristic.Model, model + " " + name)
            .setCharacteristic(Characteristic.SerialNumber, url);

        accessory.on('identify', self.Identify.bind(self, accessory));

        self.accessories[name] = accessory;
        self.api.registerPlatformAccessories("homebridge-mcuiot", "mcuiot", [accessory]);
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

mcuiot.prototype.configurationRequestHandler = function(context, request, callback) {

    this.log("configurationRequestHandler");

}

// Helpers, should move to a module

function fixInheritance(subclass, superclass) {
    var proto = subclass.prototype;
    inherits(subclass, superclass);
    subclass.prototype.parent = superclass.prototype;
    for (var mn in proto) {
        subclass.prototype[mn] = proto[mn];
    }
}

// Set mDNS timeout to 5 seconds

function handleError(err) {
    switch (err.errorCode) {
        case mdns.kDNSServiceErr_Unknown:
            console.warn(err);
            setTimeout(createBrowser, 5000);
            break;
        default:
            console.warn(err);
    }
}

function roundInt( string ){
  return Math.round(parseFloat(string));
}


function httpRequest(url, body, method, callback) {
    request({
            url: url,
            body: body,
            method: method,
            rejectUnauthorized: false,
            timeout: 10000

        },
        function(err, response, body) {
            callback(err, response, body)
        })
}
