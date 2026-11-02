# Maintainer: Andrew Marin <andrewmarin367@gmail.com>
pkgname=gloaming-clipper
pkgver=2.15.0
pkgrel=1
pkgdesc="Medal.tv-style game clip recorder for Linux: instant replay, session recording, and one-click sharing"
arch=('x86_64')
url="https://github.com/splitshotz/Vice"
license=('GPL-3.0-or-later')
install=gloaming-clipper.install
depends=(
    'python'
    'systemd'
    'python-evdev'
    'python-aiohttp'
    'python-click'
    'python-psutil'
    'python-pywebview'
    'python-tomli-w'
    'python-pyqt6-webengine'
    'python-qtpy'
    'ffmpeg'
    'gpu-screen-recorder'
    'webkit2gtk-4.1'
    'gstreamer'
    'gst-plugins-base'
    'gst-plugins-good'
    'wl-clipboard'
    'xclip'
    'cloudflared'
    # Focused-window detection for game tagging, auto playlists and Discord
    # presence. Without these it silently detects nothing. Issue 152.
    'xdotool'
    'xorg-xprop'
    'wmctrl'
)
optdepends=(
    'wf-recorder: Wayland fallback recording backend'
    'kdotool: game detection on KDE Plasma Wayland'
    'python-gobject: keyboard overlay'
    'python-cairo: keyboard overlay'
    'gtk-layer-shell: keyboard overlay on Wayland'
)
makedepends=(
    'python-build'
    'python-installer'
    'python-setuptools'
    'python-wheel'
)
source=("$pkgname-$pkgver.tar.gz::https://github.com/splitshotz/Vice/archive/refs/tags/v$pkgver.tar.gz")
sha256sums=('SKIP')

build() {
    cd "$srcdir/Vice-$pkgver"
    python -m build --wheel --no-isolation
}

check() {
    cd "$srcdir/Vice-$pkgver"
    python -m compileall gloaming
}

package() {
    cd "$srcdir/Vice-$pkgver"

    python -m installer --destdir="$pkgdir" dist/*.whl

    install -Dm644 gloaming.desktop \
        "$pkgdir/usr/share/applications/gloaming.desktop"

    install -Dm644 assets/gloaming.svg \
        "$pkgdir/usr/share/icons/hicolor/scalable/apps/gloaming.svg"

    install -Dm644 packaging/gloaming.rules \
        "$pkgdir/usr/lib/udev/rules.d/70-gloaming-input.rules"

    install -Dm644 packaging/gloaming.service \
        "$pkgdir/usr/lib/systemd/user/gloaming.service"
}
