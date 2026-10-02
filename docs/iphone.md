# iPhoneで表示する

XIAOをiPhoneのUSB-Cから給電し、XIAOが作るWi-FiにiPhoneを接続します。SafariでXIAO上のWeb画面を開きます。温度データはWi-Fiで送るため、USBシリアルをiPhone側で読むアプリは不要です。

## 用意するもの

- これまで動作確認したXIAO ESP32-C3＋MLX90642の基板。センサの配線・2.2 kΩプルアップ・コンデンサは同じです。
- XIAOに付属するWi-Fiアンテナ。U.FL端子へ装着します。
- USB-C端子のiPhone（iPhone 15以降）とUSB-C–USB-Cケーブル。
- ファームウェアを書き込むMacとArduino IDE。

AppleはiPhone 15以降から小型機器へ最大4.5 Wの給電を案内しています。ただし、この基板とケーブルの組み合わせでの給電・連続動作は実機で確認してください。[AppleのUSB-C接続案内](https://support.apple.com/ja-jp/105099)

## 書き込みと接続

1. 基板をMacへUSB接続し、Arduino IDEで[../firmware/wifi_camera/wifi_camera.ino](../firmware/wifi_camera/wifi_camera.ino)を開きます。同じフォルダのヘッダも必要です。リポジトリのフォルダごと使用してください。
2. ボードを`XIAO_ESP32C3`、`USB CDC On Boot`を`Enabled`、ポートを基板のUSBポートに設定し、書き込みます。ESP32ボードパッケージ**3.3.12**でコンパイル確認しています。追加ライブラリのインストールは不要です。
3. 最初はMacで給電したまま、iPhoneの「設定 → Wi-Fi」で**ThermalCam**を選び、パスワード**thermalcam**を入力します。SSIDとパスワードはスケッチ先頭の`AP_SSID`・`AP_PASSWORD`で変更できます（パスワードは8〜63文字）。
4. 以下はHTTPモードの手順です。証明書を生成した場合は[HTTPS・カメラの設定手順](camera.md)へ進みます。このWi-Fiはインターネットにつながりません。接続を維持する選択肢が出たら維持し、Safariのアドレス欄に**`http://192.168.4.1`**を入力します。検索欄へ単にIPを検索するのではなく、`http://`付きで開いてください。
5. 「接続済み · ライブ表示」と熱画像が出て、手を近づけると温度が変わることを確認します。
6. 書き込み完了後にMacからUSBを抜き、iPhoneとXIAOをUSB-Cケーブルで直接接続します。起動を数秒待ち、Wi-Fiへ再接続して同じURLを開きます。これでMacなしで表示できます。

USBで給電すると自動でAPとサーバを起動します。USBシリアルが開かれるのを待つ処理はありません。Safariで「HTTPS-Onlyが有効になっているHTTP URL」のエラーが出る場合は、「設定 → アプリ → Safari → プライバシーとセキュリティ」の「接続が安全ではないときに警告」をオフにし、新しいタブで`http://192.168.4.1/`を開き直してください。この設定はSafari全体に適用されます。[設定項目の説明（Apple）](https://support.apple.com/ja-jp/guide/iphone/iphfba2ed790/ios)・[同じエラーへの対処（滋賀医科大学、p.24）](https://www.shiga-med.ac.jp/mmc/service/vpn/pdf/vpn_client_iphone.pdf#page=24)

## 画面でできること

- 32×24画素の熱画像と、最低・中央・最高温度、センサ自身の温度（Ta）、受信fpsの表示。
- タップした元画素の温度表示。キーボードの矢印キーでも測定点を移動できます。
- 自動／固定温度レンジ、Iron／グレースケール、表示補間の切り替え。
- 電源の抜き差しやWi-Fi切断後の自動再接続。Safariが背景に回った場合も、戻ると再接続します。
- センサの読み取りエラーやデータ停止の表示。画像が古くなった場合は暗くし、温度数値を消します。

## 動かない場合

| 症状 | 確認すること |
| --- | --- |
| Wi-Fi一覧にThermalCamがない | Wi-Fi版を書き込んだか、USB-Cで給電できているか、付属アンテナを装着したか。まずMac給電で試す |
| Wi-Fiはつながるが画面が開かない | インターネットなしのWi-Fi接続を維持し、`http://192.168.4.1`をSafariで開く |
| SafariでHTTPS-Onlyのエラーが出る | 上記のSafari設定で「接続が安全ではないときに警告」をオフにし、HTTPのURLを新しいタブで開く。再書き込みは不要 |
| 「センサを読み取れません」 | `3V3`–`VDD`、`GND`、D4/GPIO6–SDA、D5/GPIO7–SCL、プルアップを確認。センサへ5 Vは接続しない |
| 「連続温度測定モードになっていません」 | 既存のセンサ設定が通常の連続温度出力か確認。この版はセンサのEEPROMを書き換えない |
| Macでは動くがiPhone給電で再起動する | ケーブル・端子・基板の短絡、3.3 V出力を確認。給電条件の切り分けにMac／USB電源を使う |
| 切断後に表示が戻らない | 設定でThermalCamへ接続し直し、画面の「再接続」を押す |

MacにつないだときのWi-Fi版の診断ログは**115200 baud**です。`http://192.168.4.1/api/status`でもセンサ状態を確認できます。

## 実装と確認範囲

ESP32コアに含まれるWi-FiとESP-IDFのHTTP/WebSocketサーバを使い、HTML・CSS・JavaScriptは本体のFlashから配信します。CDN・外部サーバ・既存Wi-Fiルーター・インターネット接続は不要です。

温度データは1フレーム1556バイトのバイナリです。20バイトの`THM1`ヘッダに幅・高さ・連番・取得時刻・Ta（符号付き整数÷100）を入れ、768画素の温度（符号付き整数÷50）を行順に続けます。整数はlittle-endianです。送信待ちを溜めず、最新フレームだけ保持します。

センサの読み取りは既存のシリアル版をもとに、データ準備フラグとBUSYフラグを確認します。リフレッシュレート・放射率などのEEPROM設定は変更せず、現在のセンサ設定で配信します。出荷設定のリフレッシュレートは8 Hzですが、画面のfpsは実際の受信レートです。[MLX90642データシートp.16、p.26](https://media.melexis.com/-/media/files/documents/datasheets/mlx90642-datasheet-melexis.pdf)

XIAO向けコンパイル、C++からJavaScriptへのパケット変換、模擬WebSocketを使った画面の確認を行っています。利用者から書き込みとMacでの表示成功の報告があります。**iPhoneのSafariでの表示とiPhoneからの給電・連続動作は未確認です。** 元の[USBシリアル版](../firmware/serial_stream/serial_stream.ino)へ戻す場合は、そのスケッチを書き込み直せます。

iPhoneの可視光カメラと重ねる場合は、[HTTPS・カメラの設定手順](camera.md)を行います。HTTPでの熱画像表示は従来どおり使えます。

## Web画面の変更とローカル確認

`web/`を編集したら、配信用ヘッダを再生成してからスケッチを書き込みます。生成済みヘッダを収録しているので、通常のArduino書き込み時にPythonやNode.jsは不要です。

```sh
uv run --no-project tools/embed_web_ui.py
uv run --no-project tools/embed_web_ui.py --check
node --test tests/frame.test.mjs
uv run --no-project tools/preview_server.py
```

最後のコマンドは`http://127.0.0.1:8765`で**模擬データ**を表示します。Mac上のブラウザ確認用で、実センサを接続しません。停止は`Ctrl+C`。テストには`clang++`（macOSのCommand Line Tools）を使います。
