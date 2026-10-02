# mlx90642-thermalcam

MLX90642とXIAO ESP32-C3を使った自作サーモカメラ。

## iPhoneで表示（Wi-Fi版）

1. Arduino IDEで[firmware/wifi_camera/wifi_camera.ino](firmware/wifi_camera/wifi_camera.ino)を書き込みます。ボードは`XIAO_ESP32C3`、`USB CDC On Boot`は`Enabled`。
2. iPhoneとXIAOをUSB-Cケーブルで接続して給電します（USB-C端子のiPhoneを使用）。
3. iPhoneのWi-Fiで **ThermalCam** に接続します。パスワードは **thermalcam**。
4. Safariで **http://192.168.4.1** を開きます。

熱画像・最低／中央／最高温度・タップ位置の温度を表示し、表示レンジと補間を切り替えられます。インターネットやアプリは不要です。

[接続手順・トラブル対処・確認範囲](docs/iphone.md)を参照してください。最初にMac給電でWi-Fi表示を確認すると切り分けやすくなります。

iPhoneの背面カメラも使う場合は、[HTTPS・カメラの設定手順](docs/camera.md)を行います。証明書はMacのコマンドで生成し、iPhoneへ初回だけ登録・信頼を設定します。カメラ全体に熱画像の小窓を置くPiP、重ね合わせ、AIを使わない輪郭合成を選べます。表示ごとの大きさ・位置・濃さを調整し、この端末に保存できます。


## 接続

MacとXIAOをUSB-Cで接続し、給電・書き込み・温度データの受信に使います。
XIAOとMLX90642は次の4本を接続します。

| XIAO ESP32-C3 | MLX90642 |
| --- | --- |
| `3V3` | Pin 2: `VDD` |
| `GND` | Pin 3: `GND` |
| `D4` / `GPIO6` | Pin 1: `SDA` |
| `D5` / `GPIO7` | Pin 4: `SCL` |

- `SDA`と`3V3`の間、`SCL`と`3V3`の間に、それぞれ2.2 kΩを入れます（プルアップ、信号線への直列接続ではありません）。
- 100 nFと10 µFは、センサの近くで`VDD`–`GND`間に並列接続します。
- **センサへ5 Vを接続しないでください。** ピンの向きは[データシートp.4](https://media.melexis.com/-/media/files/documents/datasheets/mlx90642-datasheet-melexis.pdf#page=4)で確認し、通電前に電源の短絡・配線の導通を確認します。

I²Cアドレスは`0x66`、I²Cクロックは400 kHzです。


## Macで表示（USBシリアル版）

### XIAOへの書き込み

1. Arduino IDEで`firmware/serial_stream/serial_stream.ino`を開きます。
2. ボードを`XIAO_ESP32C3`、`USB CDC On Boot`を`Enabled`に設定し、接続したUSBポートを選んで書き込みます。ESP32ボードパッケージ3.3.12を使用しました。追加のセンサライブラリは不要です。
3. 書き込み後はArduino IDEのシリアルモニタを閉じます。

### Macで表示

リポジトリのルートで、[uv](https://docs.astral.sh/uv/)を使って実行します。

```sh
ls /dev/cu.*
uv run --no-project --python 3.12 \
  --with-requirements mlx90642_viewer/requirements.txt \
  mlx90642_viewer/thermal_view.py /dev/cu.usbmodem1101
```

`/dev/cu.usbmodem1101`は今回のポート名です。実際のポート名に置き換えてください。

通信速度は両側とも**460800 baud**。1フレームを`FRAME,<Ta>,<p0>,...,<p767>`のCSV行で送り、温度の単位は°Cです。表示レンジはフレームごとに自動調整します。

ポートが`Resource busy`になる場合はシリアルモニタなどを閉じてください。`Bad frame length`が出る場合は、送受信の通信速度を確認します。

## 参考

- [MLX90642データシート](https://media.melexis.com/-/media/files/documents/datasheets/mlx90642-datasheet-melexis.pdf)
- [XIAO ESP32-C3公式ガイド](https://wiki.seeedstudio.com/XIAO_ESP32C3_Getting_Started/)
