# JSON Dictionary

Okurken karşına çıkan İngilizce kelimeleri kaydedip kendi listenle oyun oynayarak öğrenmen için web uygulaması. Kurulum gerektirmez; Windows, Linux, macOS ve telefonda tarayıcıda çalışır.

| Klasör | İçerik |
|---|---|
| `web/` | Uygulama. Ayrıntılar: [web/README.md](web/README.md) |
| `data/` | Kelime dosyaları. `gelismis.json` güncel biçimde, `gelismis.eski-bicim.json` dönüştürme öncesi yedek. Yayınlanmaz. |
| `.github/workflows/pages.yml` | `web/` klasörünü GitHub Pages'e yayınlar |

## Yerelde çalıştırma

```sh
python3 -m http.server 8765 --directory web
# http://localhost:8765
```
