import sys
import serial
import numpy as np
import matplotlib.pyplot as plt

WIDTH = 32
HEIGHT = 24
PIXELS = WIDTH * HEIGHT

PORT = sys.argv[1] if len(sys.argv) >= 2 else "/dev/cu.usbmodem1101"
BAUD = 460800

ser = serial.Serial(PORT, BAUD, timeout=2)
ser.reset_input_buffer()

plt.ion()
fig, ax = plt.subplots()

frame0 = np.zeros((HEIGHT, WIDTH), dtype=float)

im = ax.imshow(frame0, cmap="inferno", interpolation="nearest")
cbar = plt.colorbar(im, ax=ax)
title = ax.set_title("MLX90642")
ax.set_xlabel("X")
ax.set_ylabel("Y")

def update_plot(frame, ta):
    min_t = float(frame.min())
    max_t = float(frame.max())
    center_t = float(frame[HEIGHT // 2, WIDTH // 2])

    im.set_data(frame)
    im.set_clim(min_t, max_t)

    title.set_text(
        f"Ta={ta:.2f} °C   Min={min_t:.2f} °C   "
        f"Center={center_t:.2f} °C   Max={max_t:.2f} °C"
    )

    fig.canvas.draw_idle()
    plt.pause(0.001)

print(f"Opening {PORT} @ {BAUD} baud")

while True:
    try:
        line = ser.readline().decode("utf-8", errors="ignore").strip()
        if not line:
            continue

        if not line.startswith("FRAME,"):
            print(line)
            continue

        parts = line.split(",")

        expected = 2 + PIXELS
        if len(parts) != expected:
            print(f"Bad frame length: {len(parts)} (expected {expected})")
            continue

        ta = float(parts[1])
        values = np.array([float(x) for x in parts[2:]], dtype=float)

        frame = values.reshape((HEIGHT, WIDTH))
        update_plot(frame, ta)

    except KeyboardInterrupt:
        break
    except Exception as e:
        print("Parse error:", e)

ser.close()
