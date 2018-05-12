// Homebridge platform plugin supporting the display of temperature, humidity and
// soil moisture from ESP8266/Nodemcu devices connected to DHT22 and YL-69 sensors.
// Build instructions for the sensor are in LUA directory
//
// Supports automatic device discovery using mDNS
//
// Remember to add platform to config.json. Example:
//
// "platforms": [{
//    "platform": "mcuiot",
//    "name": "MCUIOT",
//    "refresh":  "60",   // Optional, device refresh time
//    "leak":     "10",    // Optional, moisture level to trigger a leak alert
//    "storage":  "fs",
//    "spreadsheetId": "xxxxxxxxxx",    // Optional - Google sheet to log data
//    "aliases": {
//      "NODE-2BA0FF": "Porch Motion"
//    }
//
// }],
//
// Supports the following nodemcu based sensor types
// DHT - DHT22 temperature / humidity sensor
// BME - BME280 temperature / humidity / barometric pressure sensor
// YL - YL-69 Soil Moisture Sensor - Implemented as a leak sensor
// GD - Garage Door Open/Close Sensor

'use strict';

var debug = require('debug')('MCUIOT');
var request = require("request");
var mdns = require('mdns');
var inherits = require('util').inherits;
var Accessory, Service, Characteristic, UUIDGen, CustomCharacteristic, FakeGatoHistoryService;
var web = require('./lib/web.js');
var logger = require("mcuiot-logger").logger;
const moment = require('moment');
var os = require("os");
var hostname = os.hostname();

module.exports = function(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;
  CustomCharacteristic = require('./lib/CustomCharacteristic.js')(homebridge);
  FakeGatoHistoryService = require('fakegato-history')(homebridge);
  fixInheritance(mcuiot.Moisture, Characteristic);

  homebridge.registerPlatform("homebridge-mcuiot", "mcuiot", mcuiot);
}

function mcuiot(log, config, api) {
  this.log = log;
  this.config = config;
  this.refresh = config['refresh'] || 60; // Update every minute
  this.leak = config['leak'] || 10; // Leak detected threshold
  this.port = config['port'] || 8080; // Default http port
  this.storage = config['storage'] || "fs";
  this.leakDetected = Date.now(); // Leak detection flapping fix

  debug("Settings: refresh=%s, leak=%s", this.refresh, this.leak);

  this.spreadsheetId = config['spreadsheetId'];
  if (this.spreadsheetId) {
    this.logger = new logger(this.spreadsheetId);
  }

  this.accessories = {}; // MAC -> Accessory

  if (typeof(config.aliases) !== "undefined" && config.aliases !== null) {
    this.aliases = config.aliases;
  }

  this.log_event_counter = {};

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

  if (accessory.getService(Service.TemperatureSensor)) {

    accessory.log = this.log;
    //    accessory.loggingService = new FakeGatoHistoryService("weather", accessory,4032,this.refresh * 10/60);
    accessory.loggingService = new FakeGatoHistoryService("weather", accessory, {
      storage: this.storage,
      minutes: this.refresh * 10 / 60
    });

    this.getDHTTemperature(accessory, function(err, temp) {
      if (err) {
        temp = err;
      }
      this.getService(Service.TemperatureSensor).getCharacteristic(Characteristic.CurrentTemperature).updateValue(temp);
    }.bind(accessory));

  }

  if (accessory.getService(Service.GarageDoorOpener))
    accessory.getService(Service.GarageDoorOpener)
    .getCharacteristic(Characteristic.TargetDoorState)
    .on('set', self.setTargetDoorState.bind(self, accessory));

  if (accessory.getService(Service.Switch))
    accessory.getService(Service.Switch)
    .getCharacteristic(Characteristic.On)
    .on('set', self.resetDevices.bind(self, accessory));

  var name = accessory.context.name;;
  self.accessories[name] = accessory;
}

mcuiot.prototype.didFinishLaunching = function() {
  var self = this;

  this.addResetSwitch();

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
      //            for (var i = 0; i < 5; i++) {

      mcuiot.prototype.mcuModel("http://" + service.host + ":" + service.port + "/", function(err, model) {
        if (!err) {
          self.addMcuAccessory(service, model);
        } else {
          self.log("Error Adding MCUIOT Device", service.name, err.message);
        }
      });
      //            }
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

  var server = web.init(this.log, this.port, this.accessories);

}

mcuiot.prototype.devicePolling = function() {
  for (var id in this.accessories) {
    var device = this.accessories[id];
    if (device.reachable) {
      if (device.getService(Service.TemperatureSensor)) {
        this.getDHTTemperature(device, function(err, temp) {
          if (err) {
            temp = err;
          }
          this.getService(Service.TemperatureSensor).getCharacteristic(Characteristic.CurrentTemperature).updateValue(temp);
        }.bind(device));
      }
    }
  }
}

// Am using the Identify function to validate a device, and if it doesn't respond
// remove it from the config

mcuiot.prototype.Identify = function(accessory, status, callback, that) {

  var self = this;

  if (that)
    self = that;

  //    self.log("Object: %s", JSON.stringify(accessory, null, 4));

  self.log("Identify Request %s", accessory.displayName);

  if (accessory.context.url) {

    httpRequest(accessory.context.url, "", "GET", function(err, response, responseBody) {
      if (err) {
        self.log("Identify failed %s", accessory.displayName, err.message);
        self.removeAccessory(accessory.displayName);
        callback(err, accessory.displayName);
      } else {
        self.log("Identify successful %s", accessory.displayName);
        callback(null, accessory.displayName);
      }
    }.bind(self));
  } else {
    callback(null, accessory.displayName);
  }

}

mcuiot.prototype.resetDevices = function(accessory, status, callback) {
  var self = this;
  this.log("Reset Devices", status);
  callback(null, status);

  if (status == "1") {

    for (var id in self.accessories) {
      var device = self.accessories[id];
      this.log("Reseting", id, device.displayName);
      mcuiot.prototype.Identify(device, status, function(err, status) {
        self.log("Done", status, err);
      }, self);
    }
    setTimeout(function() {
      accessory.getService(Service.Switch)
        .setCharacteristic(Characteristic.On, 0);
    }, 3000);
  }

}

mcuiot.prototype.setTargetDoorState = function(accessory, status, callback) {
  var self = this;

  self.log("setTargetDoorState Request", accessory.displayName, status);
  callback(null, accessory.getService(Service.GarageDoorOpener)
    .getCharacteristic(Characteristic.CurrentDoorState).value);

}

mcuiot.prototype.getDHTTemperature = function(accessory, callback) {
  var self = this;

  if (!accessory.context.url) {
    this.log.warn("Ignoring request; No url defined.");
    callback(new Error("No url defined."));
    return;
  }

  //    self.log("Object: %s", JSON.stringify(accessory, null, 4));

  var url = accessory.context.url;
  var name = accessory.context.name;
  this.log("Reading MCUIOT:", name);

  httpRequest(url, "", "GET", function(err, response, responseBody) {
    if (err) {
      this.log('HTTP get failed:', name, err.message);
      //self.removeAccessory(name);
      callback(err);
    } else {
      var response = JSON.parse(responseBody);

      if (this.log_event_counter[response.Hostname] === undefined) {
        this.log_event_counter[response.Hostname] = 0;
      } else {
        this.log_event_counter[response.Hostname] = 1 + this.log_event_counter[response.Hostname];
      }
      if (this.log_event_counter[response.Hostname] > 59) {
        this.log_event_counter[response.Hostname] = 0;
        if (this.spreadsheetId) {
          this.logger.storeData(response);
        }

      }
      // debug("MCUIOT Response %s", response);
      if (roundInt(response.Data.Status) != 0) {
        self.log("Error status %s %s", response.Hostname, roundInt(response.Data.Status));
        callback(new Error("Nodemcu returned error"));
      } else {

        //  debug(this.log_event_counter[response.Hostname], this.log_event_counter[response.Hostname] % 10);

        accessory.loggingService.addEntry({
          time: moment().unix(),
          temp: roundInt(response.Data.Temperature),
          pressure: roundInt(response.Data.Barometer),
          humidity: roundInt(response.Data.Humidity)
        });

        accessory.getService(Service.TemperatureSensor)
          .setCharacteristic(Characteristic.CurrentRelativeHumidity, roundInt(response.Data.Humidity));

        if (response.Model.endsWith("GD")) {

          // Characteristic.CurrentDoorState.OPEN = 0; = Red Flashing
          // Characteristic.CurrentDoorState.CLOSED = 1; = Green On
          // Characteristic.CurrentDoorState.OPENING = 2;
          // Characteristic.CurrentDoorState.CLOSING = 3;
          // Characteristic.CurrentDoorState.STOPPED = 4;

          //Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL = 0;
          //Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW = 1;

          // Green Flashing = no contact with sensor

          // If its not open, then see what's up!!!

          // Red Flashing, Green Off = Open
          // Red Off, Green On = Closed
          // Red Off / Tick, Green Flashing = ???


          if (response.Data.Green == "On") {
            //  debug("GarageDoor is Closed", name);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.CurrentDoorState, Characteristic.CurrentDoorState.CLOSED);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .getCharacteristic(Characteristic.TargetDoorState).updateValue(Characteristic.CurrentDoorState.CLOSED);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.ObstructionDetected, 0);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          } else if (response.Data.Red == "Flashing" && response.Data.Green == "Off") {
            self.log("GarageDoor %s is Open: Red is %s Green is ", name, response.Data.Red, response.Data.Green);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.CurrentDoorState, Characteristic.CurrentDoorState.OPEN);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.TargetDoorState, Characteristic.CurrentDoorState.OPEN);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.ObstructionDetected, 0);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          } else if (response.Data.Green == "Flashing" || (response.Data.Green == "Off" && response.Data.Red == "Off")) {
            self.log("GarageDoor %s is sensor not reachable: Red is %s Green is ", name, response.Data.Red, response.Data.Green);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.CurrentDoorState, Characteristic.CurrentDoorState.CLOSED);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .getCharacteristic(Characteristic.TargetDoorState).updateValue(Characteristic.CurrentDoorState.CLOSED);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.ObstructionDetected, 0);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
          } else {
            self.log("GarageDoor %s is at Fault: Red is %s Green is ", name, response.Data.Red, response.Data.Green);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.CurrentDoorState, Characteristic.CurrentDoorState.OPEN);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.TargetDoorState, Characteristic.CurrentDoorState.OPEN);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.ObstructionDetected, 0);
            self.accessories[name + "GD"].getService(Service.GarageDoorOpener)
              .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          }
        }

        if (response.Model.endsWith("YL")) {
          // Set moisture level for YL Models

          if (!self.accessories[name].context.moisture) {
            //debug("Water Level Averaging Init",name);
            self.accessories[name].context.moisture = [];
            self.accessories[name].context.moisture.push(1);
            self.accessories[name].context.moisture.push(1);
            self.accessories[name].context.moisture.push(1);
            self.accessories[name].context.moisture.push(1);
            self.accessories[name].context.moisture.push(1);
          }

          self.accessories[name].context.moisture.push((1024 - roundInt(response.Data.Moisture)) / 10.2);
          self.accessories[name].context.moisture.shift();

          //debug("Water Level",name,self.accessories[name].context.moisture);

          var moist = average(self.accessories[name].context.moisture);

          self.accessories[name].getService(Service.TemperatureSensor)
            .setCharacteristic(Characteristic.WaterLevel, roundInt(moist));
          // Do we have a leak ?

          debug("%s Leak: %s > %s ?", name, moist, this.leak);

          if (response.Data.Moisture == 1024) {
            debug('Leak Sensor Failed', name, response.Data.Moisture);
            self.accessories[name + "LS"].getService(Service.LeakSensor)
              .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
          } else {
            self.accessories[name + "LS"].getService(Service.LeakSensor)
              .setCharacteristic(Characteristic.StatusLowBattery, Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          }


          if (moist > this.leak) {

            this.leakDetected = Date.now() + 15 * 60 * 1000; // Don't clear alerts for 15 minutes
            debug("Leak", name);
            self.accessories[name].getService(Service.TemperatureSensor)
              .setCharacteristic(Characteristic.LeakDetected, Characteristic.LeakDetected.LEAK_DETECTED);
            self.accessories[name + "LS"].getService(Service.LeakSensor)
              .setCharacteristic(Characteristic.LeakDetected, Characteristic.LeakDetected.LEAK_DETECTED);

          } else {

            debug("No Leak", name);

            if (Date.now() > this.leakDetected) { // Don't clear alerts for a minimum of 15 minutes
              self.accessories[name].getService(Service.TemperatureSensor)
                .setCharacteristic(Characteristic.LeakDetected, Characteristic.LeakDetected.LEAK_NOT_DETECTED);
              self.accessories[name + "LS"].getService(Service.LeakSensor)
                .setCharacteristic(Characteristic.LeakDetected, Characteristic.LeakDetected.LEAK_NOT_DETECTED);
            }
          }
        }
        if (response.Model.startsWith("BME")) {
          // Set BME280 Atmospheric pressure sensor;
          self.accessories[name].getService(Service.TemperatureSensor)
            .setCharacteristic(CustomCharacteristic.AtmosphericPressureLevel, roundInt(response.Data.Barometer));
        }

        //                debug("Callback Temp",roundInt(response.Data.Temperature));
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
      //            console.log('HTTP get failed: %s', url,err.message);
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

    var displayName;
    if (this.aliases)
      displayName = this.aliases[name];
    if (typeof(displayName) == "undefined") {
      displayName = name;
    }

    var accessory = new Accessory(name, uuid, 10);

    self.log("Adding MCUIOT Device:", name, displayName, model);
    accessory.reachable = true;
    accessory.context.model = model;
    accessory.context.url = url;
    accessory.context.name = name;
    accessory.context.displayName = displayName;

    accessory.addService(Service.TemperatureSensor, displayName)
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -100,
        maxValue: 100
      });
    //      .on('get', self.getDHTTemperature.bind(self, accessory));

    accessory
      .getService(Service.TemperatureSensor)
      .addCharacteristic(Characteristic.CurrentRelativeHumidity);

    if (model.endsWith("YL")) {
      // Add YL-69 Moisture sensor
      accessory
        .getService(Service.TemperatureSensor)
        .addCharacteristic(Characteristic.WaterLevel);
      accessory
        .getService(Service.TemperatureSensor)
        .addCharacteristic(Characteristic.LeakDetected);

      this.addLeakSensor(device, model);
    }

    if (model.endsWith("GD")) {
      // Add Garage Door Position Sensor

      this.addGarageDoorOpener(device, model);
    }

    if (model.startsWith("BME")) {
      // Add BME280 Atmospheric pressure sensor;
      this.log("Adding BME", name);
      accessory.getService(Service.TemperatureSensor)
        .addCharacteristic(CustomCharacteristic.AtmosphericPressureLevel);
    }

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, "MCUIOT")
      .setCharacteristic(Characteristic.Model, model)
      .setCharacteristic(Characteristic.SerialNumber, hostname + "-" + name)
      .setCharacteristic(Characteristic.FirmwareRevision, require('./package.json').version);

    accessory.on('identify', self.Identify.bind(self, accessory));

    accessory.log = this.log;
    //    accessory.loggingService = new FakeGatoHistoryService("weather", accessory,4032,this.refresh * 10/60);
    accessory.loggingService = new FakeGatoHistoryService("weather", accessory, {
      storage: this.storage,
      minutes: this.refresh * 10 / 60
    });

    self.accessories[name] = accessory;
    self.api.registerPlatformAccessories("homebridge-mcuiot", "mcuiot", [accessory]);
  } else {
    self.log("Skipping %s", name);
    accessory = this.accessories[name];

    // Fix for devices moving on the network
    if (accessory.context.url != url) {
      debug("URL Changed", name);
      accessory.context.url = url;
    } else {
      debug("URL Same", name);
    }
    //        accessory.updateReachability(true);
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

    var displayName;
    if (this.aliases)
      displayName = this.aliases[name];
    if (typeof(displayName) == "undefined") {
      displayName = name;
    }

    var accessory = new Accessory(name, uuid, 10);

    self.log("Adding MCUIOT-LS Device:", name, displayName, model);
    accessory.reachable = true;
    accessory.context.model = model;
    accessory.context.name = name;
    //        accessory.context.url = url;

    accessory.addService(Service.LeakSensor, displayName);

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, "MCUIOT")
      .setCharacteristic(Characteristic.Model, model + " " + name)
      .setCharacteristic(Characteristic.SerialNumber, url);

    accessory.on('identify', self.Identify.bind(self, accessory));

    self.accessories[name] = accessory;
    self.api.registerPlatformAccessories("homebridge-mcuiot", "mcuiot", [accessory]);
  }
}

mcuiot.prototype.addResetSwitch = function() {
  var self = this;
  var name = "MCUIOT Reset Switch";

  var uuid = UUIDGen.generate(name);

  if (!self.accessories[name]) {
    var accessory = new Accessory(name, uuid, 10);

    self.log("Adding Reset Switch:");
    accessory.reachable = true;
    accessory.context.name = name;
    //        accessory.context.model = model;
    //        accessory.context.url = url;

    accessory.addService(Service.Switch, name)
      .getCharacteristic(Characteristic.On)
      .on('set', self.resetDevices.bind(self, accessory));

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, "MCUIOT")
      .setCharacteristic(Characteristic.Model, name)
      .setCharacteristic(Characteristic.SerialNumber, "123456");

    self.accessories[name] = accessory;
    self.api.registerPlatformAccessories("homebridge-mcuiot", "mcuiot", [accessory]);
  }
}

mcuiot.prototype.addGarageDoorOpener = function(device, model) {
  var self = this;
  var name = device.name + "GD";

  var url = "http://" + device.host + ":" + device.port + "/";
  //    self.url = url;
  //    self.name = name;
  var uuid = UUIDGen.generate(name);

  if (!self.accessories[name]) {

    var displayName;
    if (this.aliases)
      displayName = this.aliases[name];
    if (typeof(displayName) == "undefined") {
      displayName = name;
    }

    var accessory = new Accessory(name, uuid, 10);

    self.log("Adding MCUIOT-GD Device:", name, displayName, model);
    accessory.reachable = true;
    accessory.context.model = model;
    accessory.context.name = name;
    //        accessory.context.url = url;

    accessory.addService(Service.GarageDoorOpener, displayName)
      .getCharacteristic(Characteristic.TargetDoorState)
      .on('set', self.setTargetDoorState.bind(self, accessory));

    accessory.getService(Service.GarageDoorOpener)
      .addCharacteristic(Characteristic.StatusLowBattery);

    accessory.getService(Service.AccessoryInformation)
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
    var accessory = this.accessories[name];
    self.mcuModel(accessory.context.url, function(model) {
      //          accessory.updateReachability(false);
    })
  }
}

mcuiot.prototype.removeAccessory = function(name) {
  this.log("removeAccessory %s", name);
  var extensions = {
    a: "",
    b: "LS",
    c: "GD"
  };
  for (var extension in extensions) {
    this.log("removeAccessory %s", name + extensions[extension]);
    if (this.accessories[name + extensions[extension]]) {
      var accessory = this.accessories[name + extensions[extension]];
      this.api.unregisterPlatformAccessories("homebridge-mcuiot", "mcuiot", [accessory]);
      delete this.accessories[name + extensions[extension]];
      this.log("removedAccessory %s", name + extensions[extension]);
    }
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

function roundInt(string) {
  return Math.round(parseFloat(string) * 10) / 10;
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

function average(array) {
  var sum = 0;
  for (var i = 0; i < array.length; i++) {
    sum += Math.round(array[i]);
  }
  return (sum / array.length);
}
