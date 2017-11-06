local module = {}

local ads = require("ads1115")

local function led(data)
  if data > 1.25 then
    return "1"
  else
    return "0"
  end
end

local function state(data)
  if data == 0 then
    return "Off"
  elseif data < 3 then
    return "Tick"
  elseif data < 7 then
    return "Flashing"
  else
    return "On"
  end
end

local gcount = 0
local rcount = 0
local gstate = 0
local rstate = 0
local x = 0

local function main2()
  x = x + 1
  if x <= 8 then
    gcount = gcount + led(ads.readADC_Differential_0_3())
    rcount = rcount + led(ads.readADC_Differential_1_3())
  else
    x = 0
    gstate = state(gcount)
    rstate = state(rcount)
--    print(string.format("Green: %s Red: %s",gstate,rstate))
    gcount = 0
    rcount = 0
  end
end

function module.getDoorStatus()
  return gstate,rstate
end

tmr.alarm(5, 250, 1, function() main2() end )

return module
