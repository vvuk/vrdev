var container = null;
var hmd = null;
var posdev = null;
var logtext = null;

var g = {};

function startRendering() {
  g.scene = new THREE.Scene();
  g.camera = new THREE.PerspectiveCamera(75, hmd.info.pixelWidth/hmd.info.pixelHeight, 0.1, 1000);
  g.r = new THREE.WebGLRenderer();

  g.r.setSize(hmd.info.pixelWidth, hmd.info.pixelHeight);

}

function hasDevs(vrdevs) {
  log(vrdevs.length, " VR Devices");

  for (var i = 0; i < vrdevs.length; ++i) {
    var dev = vrdevs[i];

    log("=========", i);
    log(dev.id, ": ", dev.deviceType, " -- ", dev.deviceName);

    if (!hmd && dev.deviceType == "hmd") {
      hmd = dev;
      info = hmd.info;
      //log(info.toSource());

      log(info.pixelWidth + "x" + info.pixelHeight, info.eyeSeparationDistance);

      //log("leftEye");
      //log(hmd.leftEye.toSource());
      //log("rightEye");
      //log(hmd.leftEye.toSource());
    } else if (!posdev && dev.deviceType == "position") {
      posdev = dev;
    }
  }

  if (hmd && posdev) {
    startRendering();
  }
}

$(function() {
  logtext = $("#logtext")[0];
  logtext.textContent = "";

  if (false) {
    navigator.mozGetVRDevices(hasDevs);
  } else {
    hasDevs([mockHMD, mockPosition]);
  }
});

/* random util junk */

function log() {
  var s = Array.slice(arguments).join(" ");

  logtext.textContent += s;
  logtext.textContent += "\n";
}

function showPosition() {
  var fs = new Float32Array(19);
  posdev.getState(0.0, fs);

  var s = "";
  for (var i = 0; i < 19; ++i) {
    s += fs[i].toFixed(3);
    s += " ";
  }
  log(s);

  setTimeout(showPosition, 500);
}
