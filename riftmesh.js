var container = null;
var hmd = null;
var posdev = null;
var logtext = null;

var g = {};

var LEFT_EYE = 0, RIGHT_EYE = 1;

function startRendering() {
  g.width = hmd.info.pixelWidth/2;
  g.height = hmd.info.pixelHeight/2;

  g.distortionCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  g.distortionCamera.translateZ(1);

  g.r = new THREE.WebGLRenderer();
  g.r.setClearColor(0xccccee);
  g.r.setSize(g.width, g.height);

  $('#container').append(g.r.domElement);

  // Man, this really needs a saner way to build this
  g.distortionGeometries = Array(2);
  g.viewAdjust = Array(2);
  g.distortedViewport = Array(2);

  for (var eye = 0; eye < 2; ++eye) {
    var dm = eye == LEFT_EYE ? hmd.leftEye : hmd.rightEye;
    var geom = new THREE.BufferGeometry();

    // XXX this is not really ideal; we really want to pack these things all together
    // instead of using them as separate streams.
    var idx = geom.addAttribute('index', Uint16Array, dm.distortionIndices.length, 1).array;

    var pos = geom.addAttribute('position', Float32Array, dm.distortionVertices.length, 3).array;
    var fact = geom.addAttribute('factors', Float32Array, dm.distortionVertices.length, 2).array; // (timewarp, vignette)
    var texR = geom.addAttribute('texROffset', Float32Array, dm.distortionVertices.length, 2).array;
    var texG = geom.addAttribute('texGOffset', Float32Array, dm.distortionVertices.length, 2).array;
    var texB = geom.addAttribute('texBOffset', Float32Array, dm.distortionVertices.length, 2).array;

    geom.hasPositions = true;

    for (var i = 0; i < dm.distortionIndices.length; ++i) {
      idx[i] = dm.distortionIndices[i];
    }

    var dv = dm.distortionVertices;
    for (var i = 0; i < dm.distortionVertices.length; ++i) {
      pos[i*3+0] = dv[i].pos[0];
      pos[i*3+1] = dv[i].pos[1];
      pos[i*3+2] = 0;

      fact[i*2+0] = dv[i].timeWarpFactor;
      fact[i*2+1] = dv[i].vignetteFactor;

      texR[i*2+0] = dv[i].texR[0];
      texR[i*2+1] = dv[i].texR[1];
      texG[i*2+0] = dv[i].texG[0];
      texG[i*2+1] = dv[i].texG[1];
      texB[i*2+0] = dv[i].texB[0];
      texB[i*2+1] = dv[i].texB[1];
    }

    geom.offsets = [{ start: 0, index: 0, count: dm.distortionIndices.length}];

    geom.computeBoundingSphere();
    geom.computeBoundingBox();

    log("bs", geom.boundingSphere.radius);
    log("bbox",
        "[" + geom.boundingBox.min.x +","+ geom.boundingBox.min.y +","+ geom.boundingBox.min.z + "]",
        "[" + geom.boundingBox.max.x +","+ geom.boundingBox.max.y +","+ geom.boundingBox.max.z + "]");

    g.distortionGeometries[eye] = geom;
    g.viewAdjust[eye] = new THREE.Vector3(dm.viewAdjust[0], dm.viewAdjust[1], dm.viewAdjust[2]);
    g.distortedViewport[eye] = dm.distortedViewport;
  }

  var mat = new THREE.MeshBasicMaterial({color: 0x111111, side: THREE.FrontSide});

  g.scenes = Array(2);
  g.scenes[0] = new THREE.Scene();
  g.scenes[0].add(new THREE.AmbientLight(0x444444));
  g.scenes[0].add(new THREE.Mesh(g.distortionGeometries[0], mat));
  g.scenes[0].add(new THREE.Mesh(new THREE.CubeGeometry(1, 1, 0.0),
                                 new THREE.MeshBasicMaterial({color: 0xff1111, wireframe: true})));

  g.scenes[1] = new THREE.Scene();
  g.scenes[1].add(new THREE.AmbientLight(0x444444));
  g.scenes[1].add(new THREE.Mesh(g.distortionGeometries[1], mat));
  g.scenes[1].add(new THREE.Mesh(new THREE.CubeGeometry(1, 1, 0.0),
                                 new THREE.MeshBasicMaterial({color: 0xff1111, wireframe: true})));

  function redraw() {
    requestAnimationFrame(redraw);

    for (var eye = 0; eye < 2; eye++) {
      g.r.setViewport(eye * (g.width / 2), 0,
                      g.width / 2, g.height);
      g.r.setClearColor(eye ? 0xccccee : 0xeecccc);
      g.r.render(g.scenes[eye], g.distortionCamera);
    }
  }

  redraw();
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
