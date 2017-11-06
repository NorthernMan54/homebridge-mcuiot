local module = {}

local mode = 0

local function start()

  gpio.mode(config.ledBlue, gpio.OUTPUT)
  gpio.mode(config.ledRed, gpio.OUTPUT)

  local lighton=0
  tmr.alarm(0,1000,1,function()
      if lighton==0 then
        lighton=1
        if mode == 0 then
          gpio.write(config.ledBlue, gpio.HIGH)
          gpio.write(config.ledRed, gpio.HIGH)
        end
        if mode == 1 then
          gpio.write(config.ledBlue, gpio.LOW)
          gpio.write(config.ledRed, gpio.HIGH)
        end
        if mode == 2 then
          gpio.write(config.ledBlue, gpio.HIGH)
          gpio.write(config.ledRed, gpio.LOW)
        end
      else
        lighton=0
        if mode==0 then
          gpio.write(config.ledBlue, gpio.LOW)
          gpio.write(config.ledRed, gpio.HIGH)
        end
        if mode == 2 then
          gpio.write(config.ledBlue, gpio.HIGH)
          gpio.write(config.ledRed, gpio.HIGH)
        end
      end
    end)

end

function module.boot()
  print("Booting...")
  mode = 0
  start()
end

function module.connected()
  mode = 1
end

function module.mdns()
  mode = 2
end

function module.error()
  mode = 2
end

function module.flashRed()
  gpio.write(config.ledRed, gpio.LOW)
  tmr.alarm(1,200,tmr.ALARM_SINGLE,function()
      gpio.write(config.ledRed, gpio.HIGH)
    end)
end

return module
