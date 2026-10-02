#pragma once
#include <Arduino.h>

static const char SETUP_UI[] PROGMEM = R"SETUP_UI(<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ThermalCam のカメラ設定</title><style>
:root{color-scheme:dark;font-family:-apple-system,sans-serif;background:#10131a;color:#f2f4f7}
main{max-width:40rem;margin:auto;padding:1.5rem;line-height:1.8}a{color:#fac578}code{overflow-wrap:anywhere}li{margin-bottom:1rem}
</style></head><body><main><h1>iPhoneのカメラを使う</h1>
<p>初回にこの基板用の証明書を登録すると、Safariで背面カメラと熱画像を重ねられます。</p>
<ol><li>下のリンクから証明書をダウンロードします。HTTPの警告で開けない場合は、設定 → アプリ → Safari の「接続が安全ではないときに警告」を一時的にオフにします。</li>
<li>設定 → 一般 → VPNとデバイス管理（または「プロファイルがダウンロード済み」）から「ThermalCam Local CA」をインストールします。</li>
<li>設定 → 一般 → 情報 → 証明書信頼設定 で「ThermalCam Local CA」を信頼します。</li>
<li>ThermalCamのWi-Fiへ接続したままHTTPS版を開き、「背面カメラを使う」を押してカメラを許可します。</li></ol>
<p>証明書警告を無視して進むだけでは設定完了になりません。自分のMacで生成した証明書を使ってください。カメラ映像はiPhone内で表示します。</p>
)SETUP_UI";
