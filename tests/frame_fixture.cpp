#include "../firmware/wifi_camera/frame_protocol.h"
#include <cstdio>

int main() {
  thermal::FramePacket packet;
  packet.sequence = 0x01020304;
  packet.capturedAtMs = 0xf1020304;
  packet.taCentiC = -525;
  for (size_t i = 0; i < thermal::PIXELS; ++i) packet.pixels[i] = (i % 73) * 50 - 1500;
  packet.pixels[0] = -2000;
  packet.pixels[400] = 2101;
  packet.pixels[767] = 13000;
  return std::fwrite(&packet, sizeof(packet), 1, stdout) == 1 ? 0 : 1;
}
