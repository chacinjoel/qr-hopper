from pathlib import Path
import json
import re
import textwrap

root = Path(__file__).resolve().parents[1]


def replace_exact(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(
            f"{path}: expected one occurrence, found {count}: {old[:120]!r}"
        )
    path.write_text(text.replace(old, new), encoding="utf-8")


runtime = root / "src" / "hopper-one-runtime.js"
replace_exact(runtime, 'const VERSION = "1.2.1";', 'const VERSION = "1.2.2";')

runtime_text = runtime.read_text(encoding="utf-8")
helpers = textwrap.dedent(
    """
      function receiverScanDimensions(video) {
        const sourceWidth = Math.max(1, Number(video?.videoWidth) || 1080);
        const sourceHeight = Math.max(1, Number(video?.videoHeight) || 1920);
        const shortSide = Math.min(sourceWidth, sourceHeight);
        const longSide = Math.max(sourceWidth, sourceHeight);
        const scale = Math.min(1, 720 / shortSide, 1280 / longSide);
        return {
          width: Math.max(1, Math.round(sourceWidth * scale)),
          height: Math.max(1, Math.round(sourceHeight * scale)),
          sourceWidth,
          sourceHeight,
          portrait: sourceHeight >= sourceWidth,
        };
      }
      function syncReceiverViewport(video, track) {
        const geometry = receiverScanDimensions(video);
        const shell = $("cameraShell");
        shell.dataset.feedOrientation = geometry.portrait ? "portrait" : "landscape";
        shell.style.setProperty(
          "--camera-source-aspect",
          `${geometry.sourceWidth} / ${geometry.sourceHeight}`,
        );
        flight.record(
          "camera",
          "portrait-viewport-ready",
          {
            sourceWidth: geometry.sourceWidth,
            sourceHeight: geometry.sourceHeight,
            scanWidth: geometry.width,
            scanHeight: geometry.height,
            portrait: geometry.portrait,
            settings: track?.getSettings?.() || {},
          },
          geometry.portrait ? 100 : 72,
        );
        return geometry;
      }
    """
).lstrip("\n")
start_camera_anchor = "  async function startCamera() {"
if "function receiverScanDimensions(video)" not in runtime_text:
    if runtime_text.count(start_camera_anchor) != 1:
        raise RuntimeError("startCamera anchor not found exactly once")
    runtime_text = runtime_text.replace(start_camera_anchor, helpers + start_camera_anchor)
runtime.write_text(runtime_text, encoding="utf-8")

replace_exact(
    runtime,
    "          width: { ideal: 1920 },\n"
    "          height: { ideal: 1080 },\n"
    "          frameRate: { ideal: 30, min: 15 },",
    "          width: { ideal: 1080 },\n"
    "          height: { ideal: 1920 },\n"
    "          aspectRatio: { ideal: 9 / 16 },\n"
    '          resizeMode: { ideal: "crop-and-scale" },\n'
    "          frameRate: { ideal: 30, min: 15 },",
)
replace_exact(
    runtime,
    "      await video.play();\n"
    "      await tuneCameraTrack(stream.getVideoTracks()[0]);",
    "      await video.play();\n"
    "      await tuneCameraTrack(stream.getVideoTracks()[0]);\n"
    "      syncReceiverViewport(video, stream.getVideoTracks()[0]);\n"
    "      await acquireWakeLock();",
)
replace_exact(
    runtime,
    "    const maxWidth = 900,\n"
    "      scale = Math.min(1, maxWidth / video.videoWidth);\n"
    "    const width = Math.max(320, Math.round(video.videoWidth * scale)),\n"
    "      height = Math.max(220, Math.round(video.videoHeight * scale));",
    "    const { width, height } = receiverScanDimensions(video);",
)
replace_exact(
    runtime,
    "      const native = await requestFullscreen(shell);\n"
    '      shell.classList.add("receiver-fullscreen");',
    "      const native = await requestFullscreen(shell);\n"
    "      await tryPortraitLock();\n"
    '      shell.classList.add("receiver-fullscreen");',
)
replace_exact(
    runtime,
    "    app.cameraStream = null;\n"
    '    const video = $("cameraVideo");',
    "    app.cameraStream = null;\n"
    "    releaseWakeLock();\n"
    "    try {\n"
    "      screen.orientation?.unlock?.();\n"
    "    } catch {}\n"
    '    const video = $("cameraVideo");',
)
replace_exact(
    runtime,
    '$("cameraState").textContent = "AUTODOCK 3·BUSCANDO";',
    '$("cameraState").textContent = "AUTODOCK 3·VERTICAL·BUSCANDO";',
)

runtime_text = runtime.read_text(encoding="utf-8")
runtime_text, count = re.subn(
    r'"\./sw\.js\?v=1201"', '"./sw.js?v=1202"', runtime_text
)
if count != 1:
    raise RuntimeError(f"runtime service-worker version replacements: {count}")
export_anchor = "    classifyColorSamples,\n    crc32,"
if runtime_text.count(export_anchor) != 1:
    raise RuntimeError("internals export anchor not found")
runtime_text = runtime_text.replace(
    export_anchor, "    classifyColorSamples,\n    receiverScanDimensions,\n    crc32,"
)
runtime.write_text(runtime_text, encoding="utf-8")

css = root / "premium-one-receiver.css"
replace_exact(
    css,
    textwrap.dedent(
        """
        .camera-shell{
          position:relative;aspect-ratio:16/9;min-height:260px;overflow:hidden;
          border:1px solid var(--line);border-radius:20px;background:#020409;box-shadow:inset 0 0 60px rgba(0,0,0,.75)
        }
        .camera-shell video,.camera-shell>canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:fill}
        .camera-shell>canvas{z-index:2;pointer-events:none}
        """
    ).strip(),
    textwrap.dedent(
        """
        .camera-shell{
          position:relative;width:min(100%,520px);aspect-ratio:9/16;min-height:0;margin-inline:auto;overflow:hidden;
          border:1px solid var(--line);border-radius:20px;background:#000;box-shadow:inset 0 0 60px rgba(0,0,0,.75)
        }
        .camera-shell video,.camera-shell>canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
        .camera-shell video{background:#000}
        .camera-shell>canvas{z-index:2;pointer-events:none;background:transparent}
        """
    ).strip(),
)
replace_exact(
    css,
    textwrap.dedent(
        """
        .camera-shell.receiver-fullscreen{
          position:fixed;inset:0;z-index:5000;width:100vw;height:100vh;height:100dvh;min-height:0;aspect-ratio:auto;border-radius:0;border:0
        }
        """
    ).strip(),
    textwrap.dedent(
        """
        .camera-shell.receiver-fullscreen{
          position:fixed;inset:auto;left:50%;top:50%;transform:translate(-50%,-50%);z-index:5000;
          width:min(100vw,56.25vh);width:min(100vw,56.25dvh);
          height:min(100vh,177.7778vw);height:min(100dvh,177.7778vw);
          min-height:0;max-width:none;aspect-ratio:9/16;border-radius:0;border:0;background:#000;
          box-shadow:0 0 0 100vmax #000,inset 0 0 60px rgba(0,0,0,.75)
        }
        """
    ).strip(),
)

index = root / "index.html"
text = index.read_text(encoding="utf-8").replace("v=1201", "v=1202")
text = text.replace(
    "HopperCore 1.2.1 · TriFrame vertical 3-Lane",
    "HopperCore 1.2.2 · TriFrame vertical 3-Lane",
)
text = text.replace(
    "AutoDock 3 encuentra y recorta los tres cuadrantes",
    "AutoDock 3 encuadra la columna vertical y recorta los tres cuadrantes",
)
text = text.replace(
    "Incluye la pantalla emisora completa. AutoDock 3 hará el resto.",
    "Sostén ambos dispositivos verticales e incluye completa la columna A/B/C.",
)
text = text.replace(
    "La geometría se conservará en HELLO y DATA.",
    "La vista 9:16 conserva la columna A/B/C en HELLO y DATA.",
)
text = text.replace(">Vista fullscreen</button>", ">Vista fullscreen 9:16</button>")
text = text.replace(
    "<title>HopperLink ONE · Color TriFrame</title>",
    "<title>HopperLink ONE · Color TriFrame Vertical</title>",
)
index.write_text(text, encoding="utf-8")

loader = root / "hopper-one.js"
loader.write_text(
    loader.read_text(encoding="utf-8").replace("v=1201", "v=1202"),
    encoding="utf-8",
)

sw = root / "sw.js"
sw.write_text(
    sw.read_text(encoding="utf-8")
    .replace("v1201", "v1202")
    .replace("v=1201", "v=1202"),
    encoding="utf-8",
)

build = root / "tools" / "build-runtime.mjs"
replace_exact(
    build,
    "process.env.HOPPER_BUILD || '1201'",
    "process.env.HOPPER_BUILD || '1202'",
)

manifest = root / "manifest.json"
manifest_data = json.loads(manifest.read_text(encoding="utf-8"))
manifest_data["name"] = "HopperLink ONE Vertical TriFrame"
manifest_data["orientation"] = "portrait"
manifest_data["description"] = (
    "Transferencia offline premium con emisor y receptor verticales, visor de "
    "cámara 9:16, tres lanes apilados y modulación de 2, 3 y 4 bits."
)
manifest.write_text(
    json.dumps(manifest_data, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)

readme = root / "README.md"
readme_text = readme.read_text(encoding="utf-8")
readme_text = readme_text.replace(
    "# HopperLink ONE · HopperCore 1.2.1",
    "# HopperLink ONE · HopperCore 1.2.2",
)
marker = (
    "- **AutoDock 3:** detecta, ordena y corrige la perspectiva de los tres "
    "marcos cian.\n"
)
addition = (
    "- **Receiver Portrait 9:16:** solicita cámara 1080×1920, conserva la "
    "proporción sin estirar el video y alinea el canvas de AutoDock con la "
    "imagen visible.\n"
)
if marker in readme_text and addition not in readme_text:
    readme_text = readme_text.replace(marker, marker + addition)
readme.write_text(readme_text, encoding="utf-8")

test = root / "tests" / "hopper-one-color-modes.test.cjs"
test_text = test.read_text(encoding="utf-8")
test_text = test_text.replace("I.VERSION,'1.2.1'", "I.VERSION,'1.2.2'")
test_text = test_text.replace("manifest.build,'1201'", "manifest.build,'1202'")
test_text = test_text.replace(
    "sw.includes('hopperlink-one-v1201')",
    "sw.includes('hopperlink-one-v1202')",
)
old_log = "console.log('HopperLink ONE Color Modes + Portrait Stack: PASS');"
new_checks = textwrap.dedent(
    """
    const receiverCss=fs.readFileSync(path.join(root,'premium-one-receiver.css'),'utf8');
    assert(receiverCss.includes('aspect-ratio:9/16'));
    assert(receiverCss.includes('object-fit:contain'));
    assert(receiverCss.includes('width:min(100vw,56.25dvh)'));
    assert(source.includes('width: { ideal: 1080 }'));
    assert(source.includes('height: { ideal: 1920 }'));
    assert(source.includes('aspectRatio: { ideal: 9 / 16 }'));
    const portraitScan=I.receiverScanDimensions({videoWidth:1080,videoHeight:1920});
    assert.strictEqual(portraitScan.width,720);
    assert.strictEqual(portraitScan.height,1280);
    assert.strictEqual(portraitScan.portrait,true);
    assert(html.includes('Vista fullscreen 9:16'));
    console.log('HopperLink ONE Color Modes + Portrait TX/RX: PASS');
    """
).strip()
if test_text.count(old_log) != 1:
    raise RuntimeError("test log anchor not found")
test_text = test_text.replace(old_log, new_checks)
test.write_text(test_text, encoding="utf-8")

print("Applied portrait receiver viewport and scan geometry.")
