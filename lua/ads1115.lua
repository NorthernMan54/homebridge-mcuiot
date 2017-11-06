-- Credits https://github.com/Hydhen/NodeMCU/tree/master/ADS1X15

local module = {}

-- Requirements
bit = require("bit")

-- Global variable for i2c
SDA = 6
SCL = 5

-- Global variable for ADS1115
ADDR = 0x48

DELAY = 8

MASK = 0x03
CONVERT = 0x00
CONFIG = 0x01
LOWTHRESH = 0x02
HITHRESH = 0x03

MUX_SINGLE_0 = 0x4000
MUX_SINGLE_1 = 0x5000
MUX_SINGLE_2 = 0x6000
MUX_SINGLE_3 = 0x7000

OS_SINGLE = 0x8000

CQUE_NONE = 0x0003
CLAT_NONLAT = 0x0000
CPOL_ACTVLOW = 0x0000
CMODE_TRAD = 0x0000
DR_1600SPS = 0x0080
DR_32SPS = 0x0040 -- 32 samples per second
MODE_SINGLE = 0x0100
MUX_DIFF_0_1 = 0x0000 -- Differential P = AIN0, N = AIN1 (default)
MUX_DIFF_0_3 = 0x1000 -- Differential P = AIN0, N = AIN3
MUX_DIFF_1_3 = 0x2000 -- Differential P = AIN1, N = AIN3
MUX_DIFF_2_3 = 0x3000 -- Differential P = AIN2, N = AIN3

GAIN_6 = 0x0000 -- 6.144
GAIN_4 = 0x0200 -- 4.096

-- Functions
local function readRegister(address, reg)
  i2c.start(0)
  i2c.address(0, address, i2c.TRANSMITTER)
  i2c.write(0, reg)
  i2c.stop(0)

  i2c.start(0)
  i2c.address(0, address, i2c.RECEIVER)
  local all = i2c.read(0, 2)
  i2c.stop(0)

  local a = string.byte(all)
  if a == nil then
    a = 0
  end

  local b = string.byte(all, 2)
  if b == nil then
    b = 0
  end

  local ret = 0
  ret = bit.bor(ret, a)
  ret = bit.lshift(ret, 8)
  ret = bit.bor(ret, b)

  return ret
end

local function writeRegister(address, reg, value)
  i2c.start(0)
  i2c.address(0, address, i2c.TRANSMITTER)
  i2c.write(0, reg)
  -- print(string.format("value %x",value))
  local high = 0
  high = bit.rshift(value, 8)

  local low = 0
  low = bit.band(value,0xFF)
  -- print(string.format("value %x %x",high,low))
  i2c.write(0, high,low)
  i2c.stop(0)
end

local function convertToVoltage(data)
  if data > 32768 then
    data = (65536 - data )
  end
  -- TODO: This is hard coded based on the gain
  return data*0.000125
end

-- workaround for slow multiplexor

local old_config = 0
local config = 0

local function readWrapper(address, reg)
  if config == old_config then
    ret=readRegister(address, reg)
  else
    for x=1,4 do
      ret=readRegister(address, reg)
    end
  end

  old_config=config
  return ret
end

function module.readADC_SingleEnded(channel)
  if channel > 3 then
    return 0
  end

  config = 0
  config = bit.bor(config, CQUE_NONE)
  config = bit.bor(config, CLAT_NONLAT)
  config = bit.bor(config, CPOL_ACTVLOW)
  config = bit.bor(config, CMODE_TRAD)
  config = bit.bor(config, DR_1600SPS)
  config = bit.bor(config, MODE_SINGLE)

  if channel == 0 then
    config = bit.bor(config, MUX_SINGLE_0)
  elseif channel == 1 then
    config = bit.bor(config, MUX_SINGLE_1)
  elseif channel == 2 then
    config = bit.bor(config, MUX_SINGLE_2)
  elseif channel == 3 then
    config = bit.bor(config, MUX_SINGLE_3)
  end

  config = bit.bor(config, OS_SINGLE)

  writeRegister(ADDR, CONFIG, config)

  tmr.delay(DELAY)

  local ret = convertToVoltage(readWrapper(ADDR, CONVERT))

  return ret
end

-- @brief Reads the conversion results, measuring the voltage
-- difference between the P (AIN0) and N (AIN1) input. Generates
-- a signed value since the difference can be either
-- positive or negative.

function module.readADC_Differential_0_3()
  -- Start with default values

  config = 0
  config = bit.bor(config,CQUE_NONE) -- Disable the comparator (default val)
  config = bit.bor(config,CLAT_NONLAT) -- Non-latching (default val)
  config = bit.bor(config,CPOL_ACTVLOW) -- Alert/Rdy active low (default val)
  config = bit.bor(config,CMODE_TRAD) -- Traditional comparator (default val)
  config = bit.bor(config,DR_1600SPS) -- 1600 samples per second (default)
  config = bit.bor(config,MODE_SINGLE) -- Single-shot mode (default)

  -- Set PGA/voltage range
  --config |= m_gain;

  config = bit.bor(config,GAIN_4)
  -- Set channels
  config = bit.bor(config,MUX_DIFF_0_3) -- AIN0 = P, AIN1 = N

  -- Set 'start single-conversion' bit
  config = bit.bor(config,OS_SINGLE) --

  -- Write config register to the ADC
  writeRegister(ADDR, CONFIG, config)

  -- Wait for the conversion to complete
  tmr.delay(DELAY)

  local ret = readWrapper(ADDR, CONVERT)

  return convertToVoltage(ret)
end

function module.readADC_Differential_1_3()
  -- Start with default values

  config = 0
  config = bit.bor(config,CQUE_NONE) -- Disable the comparator (default val)
  config = bit.bor(config,CLAT_NONLAT) -- Non-latching (default val)
  config = bit.bor(config,CPOL_ACTVLOW) -- Alert/Rdy active low (default val)
  config = bit.bor(config,CMODE_TRAD) -- Traditional comparator (default val)
  config = bit.bor(config,DR_1600SPS) -- 1600 samples per second (default)
  config = bit.bor(config,MODE_SINGLE) -- Single-shot mode (default)

  -- Set PGA/voltage range
  --config |= m_gain;
  config = bit.bor(config,GAIN_4)

  -- Set channels
  config = bit.bor(config,MUX_DIFF_1_3) -- AIN0 = P, AIN1 = N

  -- Set 'start single-conversion' bit
  config = bit.bor(config,OS_SINGLE) --

  -- Write config register to the ADC
  writeRegister(ADDR, CONFIG, config)

  -- Wait for the conversion to complete
  tmr.delay(DELAY)

  local ret = convertToVoltage(readWrapper(ADDR, CONVERT))

  return ret
end

i2c.setup(0, SDA, SCL, i2c.SLOW)

return module
