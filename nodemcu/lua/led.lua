local module = {}

local mode = 0

local flasher = tmr.create()
local flashRed = tmr.create()

local function start()
  if config.ledState == 0 then
    return
  end

  gpio.mode(config.ledBlue, gpio.OUTPUT)
  gpio.mode(config.ledRed, gpio.OUTPUT)

  local lighton=0
  flasher:register(1000,1,function()
      if lighton==0 then
        lighton=1
        if mode == 0 then
          gpio.write(config.ledBlue, gpio.HIGH)
          gpio.write(config.ledRed, gpio.HIGH)
        end
        if mode == 1 then
          if config.ledState == 1 then
            gpio.write(config.ledBlue, gpio.LOW)
            gpio.write(config.ledRed, gpio.HIGH)
          else
            gpio.write(config.ledBlue, gpio.HIGH)
            gpio.write(config.ledRed, gpio.HIGH)
          end
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
    flasher:start()

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
  if config.ledState == 0 or config.ledState == 2 then
    return
  end

  gpio.write(config.ledRed, gpio.LOW)
  flashRed:register(200,tmr.ALARM_SINGLE,function()
      gpio.write(config.ledRed, gpio.HIGH)
    end)
    flashRed:start()
end

return module
