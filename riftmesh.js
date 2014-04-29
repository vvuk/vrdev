var container = null;
var hmd = null;
var posdev = null;
var logtext = null;

var g = {};

var LEFT_EYE = 0, RIGHT_EYE = 1;


// these are reimplementations of the Oculus SDK functions;
// See the SDK for more information (OVR_CAPI.cpp, OVR_Stereo.cpp)
function FovToNDCScaleOffset(fov)
{
  var pxscale = 2.0 / (fov.leftTan + fov.rightTan);
  var pxoffset = (fov.leftTan - fov.rightTan) * pxscale * 0.5;
  var pyscale = 2.0 / (fov.upTan + fov.downTan);
  var pyoffset = (fov.upTan - fov.downTan) * pyscale * 0.5;

  return { scale: [pxscale, pyscale], offset: [pxoffset, pyoffset] };
}

function FovToProjection(fov, rightHanded /* = true */, zNear /* = 0.01 */, zFar /* = 10000.0 */)
{
  rightHanded = rightHanded === undefined ? true : rightHanded;
  zNear = zNear === undefined ? 0.01 : zNear;
  zFar = zFar === undefined ? 10000.0 : zFar;

  var handednessScale = rightHanded ? -1.0 : 1.0;

  // start with an identity matrix
  var mobj = new THREE.Matrix4();
  var m = mobj.elements;

  // and with scale/offset info for normalized device coords
  var scaleAndOffset = FovToNDCScaleOffset(fov);

  // X result, map clip edges to [-w,+w]
  m[0*4+0] = scaleAndOffset.scale[0];
  m[0*4+1] = 0.0;
  m[0*4+2] = scaleAndOffset.offset[0] * handednessScale;
  m[0*4+3] = 0.0;

  // Y result, map clip edges to [-w,+w]
  // Y offset is negated because this proj matrix transforms from world coords with Y=up,
  // but the NDC scaling has Y=down (thanks D3D?)
  m[1*4+0] = 0.0;
  m[1*4+1] = scaleAndOffset.scale[1];
  m[1*4+2] = -scaleAndOffset.offset[1] * handednessScale;
  m[1*4+3] = 0.0;

  // Z result (up to the app)
  m[2*4+0] = 0.0;
  m[2*4+1] = 0.0;
  m[2*4+2] = zFar / (zNear - zFar) * -handednessScale;
  m[2*4+3] = (zFar * zNear) / (zNear - zFar);

  // W result (= Z in)
  m[3*4+0] = 0.0;
  m[3*4+1] = 0.0;
  m[3*4+2] = handednessScale;
  m[3*4+3] = 0.0;

  mobj.transpose();

  log(m.toSource());
  return mobj;
}

function startRendering() {
  g.width = hmd.info.pixelWidth;
  g.height = hmd.info.pixelHeight;

  g.r = new THREE.WebGLRenderer();
  g.r.setClearColor(0xccccee);
  g.r.setSize(g.width, g.height);

  $('#container').append(g.r.domElement);

  // Man, this really needs a saner way to build this
  g.distortionGeometries = Array(2);
  g.viewAdjust = Array(2);
  g.distortedViewport = Array(2);

  for (var eye = 0; eye < 2; ++eye) {
    var dm = (eye == LEFT_EYE) ? hmd.leftEye : hmd.rightEye;
    var geom = new THREE.BufferGeometry();

    // XXX this is not really ideal; we really want to pack these things all together
    // instead of using them as separate streams.
    var idx = geom.addAttribute("index", Uint16Array, dm.distortionIndices.length, 1).array;

    var pos = geom.addAttribute("position", Float32Array, dm.distortionVertices.length, 3).array;
    var fact = geom.addAttribute("aPackedData", Float32Array, dm.distortionVertices.length, 2).array; // (timewarp, vignette)
    var texR = geom.addAttribute("aTexCoordR", Float32Array, dm.distortionVertices.length, 2).array;
    var texG = geom.addAttribute("aTexCoordG", Float32Array, dm.distortionVertices.length, 2).array;
    var texB = geom.addAttribute("aTexCoordB", Float32Array, dm.distortionVertices.length, 2).array;

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

    log("viewport", g.distortedViewport[eye].toSource());
  }


  g.renderTargets = Array(2);
  g.renderTargets[0] = new THREE.WebGLRenderTarget(g.width / 2, g.height, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBFormat });
  g.renderTargets[1] = new THREE.WebGLRenderTarget(g.width / 2, g.height, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBFormat });

  if (!hmd.leftEye.uvScale) {
    hmd.leftEye.uvScale = [0.32385197281837463, 0.23383478820323944];
    hmd.leftEye.uvOffset = [0.6856241226196289, 0.5];
    hmd.rightEye.uvScale = [0.32385197281837463, 0.23383478820323944];
    hmd.rightEye.uvOffset = [0.3143759071826935, 0.5];
  }

  g.distortionShaderMaterials = Array(2);
  g.distortionShaderMaterials[0] = new THREE.ShaderMaterial({
    vertexShader: document.getElementById("distortion_vs").textContent,
    fragmentShader: document.getElementById("distortion_fs").textContent,
    depthTest: false,
    side: THREE.DoubleSide,

    attributes: {
      aPackedData: { type: "v4" },
      aTexCoordR: { tyoe: "v2" },
      aTexCoordG: { tyoe: "v2" },
      aTexCoordB: { tyoe: "v2" }
    },

    uniforms: {
      uEyeToSourceUVScale: { type: "v2", value: new THREE.Vector2(hmd.leftEye.uvScale[0], hmd.leftEye.uvScale[1]) },
      uEyeToSourceUVOffset: { type: "v2", value: new THREE.Vector2(hmd.leftEye.uvOffset[0], hmd.leftEye.uvOffset[1]) },
      uTexture: { type: "t", value: g.renderTargets[0] }
    }
  });
  g.distortionShaderMaterials[1] = new THREE.ShaderMaterial({
    vertexShader: document.getElementById("distortion_vs").textContent,
    fragmentShader: document.getElementById("distortion_fs").textContent,
    depthTest: false,
    side: THREE.DoubleSide,

    attributes: {
      aPackedData: { type: "v4" },
      aTexCoordR: { tyoe: "v2" },
      aTexCoordG: { tyoe: "v2" },
      aTexCoordB: { tyoe: "v2" }
    },

    uniforms: {
      uEyeToSourceUVScale: { type: "v2", value: new THREE.Vector2(hmd.rightEye.uvScale[0], hmd.rightEye.uvScale[1]) },
      uEyeToSourceUVOffset: { type: "v2", value: new THREE.Vector2(hmd.rightEye.uvOffset[0], hmd.rightEye.uvOffset[1]) },
      uTexture: { type: "t", value: g.renderTargets[1] }
    }
  });

  {
    // the scene that takes care of drawing the two eyes using distortion matrices
    g.distortionCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
    g.distortionCamera.translateZ(1);

    g.distortionScene = new THREE.Scene();
    g.distortionScene.add(new THREE.Mesh(g.distortionGeometries[0], g.distortionShaderMaterials[0]));
    g.distortionScene.add(new THREE.Mesh(g.distortionGeometries[1], g.distortionShaderMaterials[1]));
  }

  {
    // debug camera & scene; just draws undistorted views side by side
    if (false) {
      g.debugCamera = new THREE.OrthographicCamera(-g.width/2 - 10, g.width/2 + 10, g.height/2 + 10, -g.height/2 -10, 0.1, 10000);
      g.debugCamera.translateZ(100);
      var planeLeft = new THREE.Mesh(new THREE.PlaneGeometry(g.width / 2, g.height), new THREE.MeshBasicMaterial({ color: 0x00ff00, map: g.renderTargets[0] }))
      planeLeft.translateX(-g.width/4);
      var planeRight = new THREE.Mesh(new THREE.PlaneGeometry(g.width / 2, g.height), new THREE.MeshBasicMaterial({ color: 0x0000ff, map: g.renderTargets[1] }))
      planeRight.translateX(g.width/4);
    }

    g.debugCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
    g.debugCamera.translateZ(1);
    var planeLeft = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0x00ff00, map: g.renderTargets[0] }))
    planeLeft.translateX(-0.5);
    var planeRight = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0x0000ff, map: g.renderTargets[1] }))
    planeRight.translateX(0.5);

    g.debugScene = new THREE.Scene();
    g.debugScene.add(planeLeft);
    g.debugScene.add(planeRight);
  }

  {
    // the actual content scene
    g.mainScene = new THREE.Scene();
    g.mainScene.add(new THREE.AmbientLight(0x44aa44));
    g.mainScene.add(new THREE.Mesh(new THREE.TorusGeometry(10, 25, 15, 30), new THREE.MeshBasicMaterial({color: 0xff1111, side: THREE.DoubleSide })));
    g.mainScene.add(new THREE.Mesh(new THREE.CubeGeometry(10, 10, 10), new THREE.MeshBasicMaterial({color: 0xff1111, wireframe: true})));
  }

  g.eyeCameras = Array(2);
  g.eyeCameras[0] = new THREE.Camera();
  g.eyeCameras[1] = new THREE.Camera();

  g.eyeCameras[0].projectionMatrix = FovToProjection(hmd.info.recommendedEyeFieldOfView[0]);
  g.eyeCameras[1].projectionMatrix = FovToProjection(hmd.info.recommendedEyeFieldOfView[1]);

  g.eyeCameras[0].translateZ(25);
  g.eyeCameras[1].translateZ(25);

  var fv = new Float32Array(32);
  var qrot = new THREE.Quaternion();

  function redraw() {
    requestAnimationFrame(redraw);

    posdev.getState(0.0, fv);
    qrot.set(fv[0], fv[1], fv[2], fv[3]);

    for (var eye = 0; eye < 2; eye++) {
      g.eyeCameras[eye].setRotationFromQuaternion(qrot);
      g.r.setClearColor(eye ? 0xccccee : 0xeecccc);
      g.r.render(g.mainScene, g.eyeCameras[eye], g.renderTargets[eye], true);
    }

    g.r.setClearColor(0);
    g.r.render(g.distortionScene, g.distortionCamera);
    //g.r.render(g.debugScene, g.debugCamera);
    //g.r.render(g.mainScene, g.eyeCameras[1]);
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

  if (false) {
    log("====== mock.js ======");
    var mockOutHMD = { id: "mockjs0", deviceType: "hmd", deviceName: "MockJS", info: hmd.info, leftEye: hmd.leftEye, rightEye: hmd.rightEye };
    var mockOutPos = { id: "mockjs0", deviceType: "position", deviceName: "MockJS" };
    log("var mockHMD = ");
    log(mockOutHMD.toSource());
    log(";");
    log("var mockPosition = ");
    log(mockOutPos.toSource());
    log(";");
    log("mockHMD.setEyeFov = function() { alert('setEyeFov not supported in mockHMD'); };");
    log("mockPosition.getState = function(timeOffset, fvals) { for (var i = 0; i < 19; ++i) { fvals[i] = 0.0; } return 19; };");
    return;
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
    mockPosition.t = performance.now();
    mockPosition.getState = function(timeOffset, fvals) {
      var q = new THREE.Quaternion();
      var angVelocity = Math.PI / 5000.0;
      var tdelta = performance.now() - mockPosition.t + timeOffset;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), tdelta * angVelocity);

      fvals[0] = q.x; fvals[1] = q.y; fvals[2] = q.z; fvals[3] = q.w;
      for (var i = 4; i < 19; ++i) { fvals[i] = 0.0; }
      return 19;
    };

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
