#pragma once

#include <cstddef>
#include <cstdint>

namespace thermal {
constexpr uint16_t WIDTH = 32;
constexpr uint16_t HEIGHT = 24;
constexpr size_t PIXELS = WIDTH * HEIGHT;

// THM1: little-endian header, followed by row-major signed To * 50 values.
struct FramePacket {
  uint8_t magic[4] = {'T', 'H', 'M', '1'};
  uint16_t width = WIDTH;
  uint16_t height = HEIGHT;
  uint32_t sequence = 0;
  uint32_t capturedAtMs = 0;
  int16_t taCentiC = 0;
  uint16_t reserved = 0;
  int16_t pixels[PIXELS] = {};
};

static_assert(offsetof(FramePacket, pixels) == 20, "Unexpected frame header layout");
static_assert(sizeof(FramePacket) == 20 + PIXELS * 2, "Unexpected frame size");
}  // namespace thermal
