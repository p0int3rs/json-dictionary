# JSON Dictionary

Okurken karşına çıkan İngilizce kelimeleri kaydedip kendi listenle oyun oynayarak öğrenmen için web uygulaması. Kurulum gerektirmez; Windows, Linux, macOS ve telefonda tarayıcıda çalışır.

| Klasör | İçerik |
|---|---|
| `web/` | Uygulama. Ayrıntılar: [web/README.md](web/README.md) |
| `.github/workflows/pages.yml` | `web/` klasörünü GitHub Pages'e yayınlar |

Kelimeler tarayıcıda saklanır; kişisel kelime dosyaları bu repoya konmaz (`data/` klasörü `.gitignore`'da).

## Yerelde çalıştırma

```sh
python3 -m http.server 8765 --directory web
# http://localhost:8765
```
