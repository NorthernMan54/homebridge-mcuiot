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
        self.api.on('didFinishLaunching', self.didFinishLaunching.bind(self));
    }
}

mcuiot.prototype.configureAccessory = function(accessory) {
    var self = this;

    accessory.reachable = true;
    self.log("configureAccessory %s", accessory.displayName);

    accessory.getService(Service.TemperatureSensor)
        .getCharacteristic(Characteristic.CurrentTemperature)
        .on('get', self.getDHTTemperature.bind(self,accessory));

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
            //        console.log("service up: ", service);
            self.log("Found url http://%s:%s/", service.host, service.port);
            var url = "http://" + service.host + ":" + service.port + "/";
            mcuiot.prototype.mcuModel(url,function(model) {
              self.addMcuAccessory(service,model);
            })

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


mcuiot.prototype.getDHTTemperature = function(accessory,callback) {
    var self = this;

    if (!self.url) {
        self.log.warn("Ignoring request; No url defined.");
        callback(new Error("No url defined."));
        return;
    }

    //    self.log("Object: %s", JSON.stringify(accessory, null, 4));

    var url = accessory.context.url;
    var name = accessory.displayName;
    self.log("Reading DHT %s %s", name, url);

    self.httpRequest(url, "", "GET", function(error, response, responseBody) {
        if (error) {
            self.log('HTTP get failed: %s', error.message);
            callback(error);
        } else {
            var response = JSON.parse(responseBody);

            self.log("DHT Response %s", JSON.stringify(response, null, 4));
            self.accessories[name].getService(Service.TemperatureSensor)
                .setCharacteristic(Characteristic.CurrentRelativeHumidity, parseFloat(response.Data.Humidity));

            if (response.Model == "DHT-YL") {
                var moist = (1024 - parseFloat(response.Data.Moisture)) / 10.2;
                self.accessories[name].getService(Service.TemperatureSensor)
                    .setCharacteristic("Moisture", parseFloat(moist));
            }

            callback(null, parseFloat(response.Data.Temperature));
        }
    }.bind(self));
}

mcuiot.prototype.mcuModel = function(url, callback) {
    var self = this;
    var model;
    //    this.log("Object: %s", JSON.stringify(this, null, 4));

    // console.log("Reading DHT Model %s", url);

    self.httpRequest(url, "", "GET", function(error, response, responseBody) {
        if (error) {
            console.log('HTTP get failed: %s', error.message);
            callback(error);
        } else {
            var response = JSON.parse(responseBody);

      //      console.log("DHT Response %s", response.Hostname, response.Model, response.Version);

            model = response.Model;

            callback(model);

        }
    }.bind(self));


}

mcuiot.prototype.addMcuAccessory = function(device,model) {
    var self = this;
    var name = device.name;
    var host = device.host;
    var port = device.port;
    var url = "http://" + host + ":" + port + "/";
    self.url = url;
    self.name = name;
    var uuid = UUIDGen.generate(name);

    if (!self.accessories[name]) {
//        self.log("addMcuAccessory 191 %s", name);
        var accessory = new Accessory(name, uuid, 10);

//        var model = self.mcuModel(url);

        self.log("addMcuAccessory 195 %s", name, model);
        accessory.reachable = true;
        accessory.context.model = model;
        accessory.context.url = url;
//        this.log("Category %s ", newAccessory.category);

        accessory.addService(Service.TemperatureSensor, name)
            .getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', self.getDHTTemperature.bind(self,accessory));

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
            .setCharacteristic(Characteristic.Model, model)
            .setCharacteristic(Characteristic.SerialNumber, url);

//        newAccessory
//            .addService(Service.BridgingState)
//            .getCharacteristic(Characteristic.Reachable)
//            .setValue(true);

//        newAccessory
//            .getService(Service.BridgingState)
//            .getCharacteristic(Characteristic.Category)
//            .setValue(newAccessory.category);

        self.accessories[name] = accessory;
        self.api.registerPlatformAccessories("homebridge-mcuiot", "mcuiot", [accessory]);
    } else {
        self.log("Skipping %s", name);
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
