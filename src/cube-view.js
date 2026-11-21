import { faces, isCubeRotation, slotFaces, turnFace, turnPower } from './cube.js';

const axes = {
  U: [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
  R: [[1, 0, 0], [0, 0, -1], [0, -1, 0]],
  F: [[0, 0, 1], [1, 0, 0], [0, -1, 0]],
  D: [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
  L: [[-1, 0, 0], [0, 0, 1], [0, -1, 0]],
  B: [[0, 0, -1], [-1, 0, 0], [0, -1, 0]],
};
const isWideTurn = move => /^[urfdlb]/.test(move ?? '');

const palette = {
  U: ['#fff65b', '#e7dc1c'], R: ['#ff9062', '#eb673e'],
  F: ['#60d8ab', '#28ac82'], D: ['#f7f7ee', '#c2c9cc'],
  L: ['#f86d87', '#cb405b'], B: ['#6fa9ff', '#3d6fe3'],
};
const mutedSticker = ['#586471', '#3b4652'];
const mutedCenters = {
  U: ['#aba855', '#726f34'], R: ['#ac7762', '#70482f'], F: ['#6ba48c', '#426757'],
  D: ['#9ba2a7', '#6a7177'], L: ['#a9727e', '#67404e'], B: ['#728ab4', '#455a83'],
};
const add = (a, b) => a.map((value, i) => value + b[i]);
const scale = (v, k) => v.map(n => n * k);
const dot = (a, b) => a.reduce((sum, number, i) => sum + number * b[i], 0);
const cross = ([x, y, z], [a, b, c]) => [y * c - z * b, z * a - x * c, x * b - y * a];
const lerp = (a, b, t) => a.map((number, i) => number + (b[i] - number) * t);
const pieces = [-1, 0, 1].flatMap(x => [-1, 0, 1].flatMap(y => [-1, 0, 1].map(z => [x, y, z])));

function rotate(v, axis, angle) {
  const cosine = Math.cos(angle);
  return add(add(scale(v, cosine), scale(cross(axis, v), Math.sin(angle))), scale(axis, dot(axis, v) * (1 - cosine)));
}

function rotateByQuaternion(v, [x, y, z, w]) {
  const axis = [x, y, z];
  const offset = scale(cross(axis, v), 2);
  return add(add(v, scale(offset, w)), cross(axis, offset));
}

function surface(center, across, down, size) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => add(center, add(scale(across, x * size), scale(down, y * size))));
}

function roundPolygon(context, corners, radius) {
  context.beginPath();
  corners.forEach((point, index) => {
    const start = lerp(point, corners.at(index - 1), radius);
    const end = lerp(point, corners[(index + 1) % corners.length], radius);
    if (index) context.lineTo(...start);
    else context.moveTo(...start);
    context.quadraticCurveTo(...point, ...end);
  });
  context.closePath();
}

function cameraAt(yaw, pitch) {
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  return { toward: [sy * cp, sp, cy * cp], right: [cy, 0, -sy], up: [-sy * sp, cp, -cy * sp] };
}

const guideYaw = Math.PI / 4;
const guidePitch = 0.48;
const guideCamera = cameraAt(guideYaw, guidePitch);

function drawCube(context, state, camera, project, { animation, highlighted, guideLayer, wideGuide, markers } = {}) {
  const polygons = [];
  for (const piece of pieces) {
    const active = animation && (animation.wholeCube || dot(piece, animation.axis) >= (animation.wide ? 0 : 1));
    const transform = v => active ? rotate(v, animation.axis, animation.angle) : v;
    const muted = highlighted && !highlighted.some(target => target.every((value, index) => value === piece[index]));
    const guide = guideLayer && dot(piece, guideLayer) >= (wideGuide ? 0 : 1);
    const key = piece.join(',');
    const targetPiece = markers?.pieces.has(key);
    const targetSlot = !animation && markers?.slots.has(key);
    for (const [face, [normal, across, down]] of Object.entries(axes)) {
      const facing = dot(transform(normal), camera.toward);
      if (facing < 0.001) continue;
      const external = dot(piece, normal) === 1;
      if (!external && (!animation || animation.wholeCube)) continue;
      const faceCenter = add(piece, scale(normal, 0.49));
      const depth = dot(transform(faceCenter), camera.toward);
      const corners = surface(faceCenter, across, down, 0.496).map(transform).map(project);
      let sticker;
      if (external) {
        const row = dot(piece, down) + 1;
        const column = dot(piece, across) + 1;
        const color = state[faces.indexOf(face) * 9 + row * 3 + column];
        const colors = muted ? (row === 1 && column === 1 ? mutedCenters[color] : mutedSticker) : palette[color];
        const stickerCenter = add(piece, scale(normal, 0.498));
        sticker = { colors, corners: surface(stickerCenter, across, down, 0.438).map(transform).map(project) };
      }
      polygons.push({ depth, corners, sticker, face, guide, targetPiece, targetSlot });
    }
  }
  for (const { corners, sticker, face, guide, targetPiece, targetSlot } of polygons.sort((a, b) => a.depth - b.depth)) {
    roundPolygon(context, corners, 0.12);
    context.fillStyle = '#10161d';
    context.fill();
    context.strokeStyle = '#06090d';
    context.lineWidth = 1.5;
    context.stroke();
    if (!sticker) continue;
    const [start, end] = sticker.colors;
    const gradient = context.createLinearGradient(...sticker.corners[0], ...sticker.corners[2]);
    gradient.addColorStop(0, start);
    gradient.addColorStop(1, end);
    roundPolygon(context, sticker.corners, 0.115);
    context.fillStyle = gradient;
    context.fill();
    if (face === 'R' || face === 'L' || face === 'B' || face === 'D') {
      context.fillStyle = '#17202c20';
      context.fill();
    }
    context.strokeStyle = guide ? '#fff3c4' : '#fff2c55c';
    context.lineWidth = guide ? 1.5 : 0.75;
    context.stroke();
    if (targetPiece) drawMarker(context, sticker.corners, '#ffffff');
    if (targetSlot) {
      const center = lerp(sticker.corners[0], sticker.corners[2], 0.5);
      drawMarker(context, sticker.corners.map(point => lerp(point, center, 0.2)), '#fadc73', [4, 3]);
    }
  }
}

function drawMarker(context, corners, color, dash = []) {
  context.save();
  roundPolygon(context, corners, 0.13);
  context.setLineDash(dash);
  context.strokeStyle = '#11151e';
  context.lineWidth = 4;
  context.stroke();
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke();
  context.restore();
}

const cornerPositions = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
const edgePositions = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
const previewViews = [
  { faces: 'UFR', yaw: 0.68 },
  { faces: 'UFL', yaw: -0.68 },
  { faces: 'UBR', yaw: Math.PI - 0.68 },
  { faces: 'UBL', yaw: 0.68 - Math.PI },
];
let previewCanvas;

function pieceCoordinates(pieceFaces) {
  return [...pieceFaces].reduce((position, face) => add(position, axes[face][0]), [0, 0, 0]);
}

function targetPositions(cube, slots) {
  const current = slots.flatMap(slot => [
    cornerPositions[cube.cp.indexOf(slot + 4)],
    edgePositions[cube.ep.indexOf(slot + 8)],
  ]);
  const destinations = slots.flatMap(slot => [`D${slotFaces[slot]}`, slotFaces[slot]])
    .map(slot => [...slot].map(face => faces[cube.center.indexOf(faces.indexOf(face))]).join(''));
  return { current, destinations };
}

export function caseThumbnail(cube) {
  const { current: targets } = targetPositions(cube, [0]);
  const [corner, edge] = targets;
  const highlighted = targets.map(pieceCoordinates);
  // Prefer the training angle whenever it shows both pieces. Rotate around U for hidden cases.
  const view = previewViews.find(view => targets.every(piece => [...piece].some(face => view.faces.includes(face)))) ?? previewViews[0];
  const camera = cameraAt(view.yaw, 0.52);
  if (!previewCanvas) {
    previewCanvas = document.createElement('canvas');
    previewCanvas.width = 120;
    previewCanvas.height = 110;
  }
  const context = previewCanvas.getContext('2d');
  context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  const project = v => [60 + dot(v, camera.right) * 24, 55 - dot(v, camera.up) * 24];
  drawCube(context, cube.asString(), camera, project, { highlighted });
  return { src: previewCanvas.toDataURL('image/png'), description: `Target corner at ${corner}, target edge at ${edge}` };
}

export class CubeView {
  yaw = guideYaw;
  pitch = guidePitch;
  zoom = 1;
  frame = 0;
  orientationFrame = 0;
  targetSlots = [];

  constructor(canvas, { compact = false } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.compact = compact;
    this.observer = new ResizeObserver(() => this.paint());
    this.observer.observe(canvas);
    let drag;
    canvas.addEventListener('pointerdown', event => {
      if (this.fixedView) return;
      drag = [event.clientX, event.clientY, this.yaw, this.pitch];
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag || this.fixedView) return;
      this.yaw = drag[2] - (event.clientX - drag[0]) * 0.012;
      this.pitch = Math.max(-1.35, Math.min(1.35, drag[3] + (event.clientY - drag[1]) * 0.011));
      this.paint();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, () => { drag = null; });
  }

  destroy() {
    this.observer.disconnect();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.orientationFrame);
  }

  setOrientation(orientation) {
    if (this.orientation === orientation) return;
    const trackingChanged = Boolean(this.orientation) !== Boolean(orientation);
    this.orientation = orientation;
    if (trackingChanged) {
      this.resetView();
      return;
    }
    if (this.orientationFrame) return;
    this.orientationFrame = requestAnimationFrame(() => {
      this.orientationFrame = 0;
      if (!this.animation) this.paint();
    });
  }

  resetView() {
    this.referenceOrientation = this.orientation;
    this.yaw = this.orientation ? 0 : guideYaw;
    this.pitch = guidePitch;
    this.paint();
  }

  get fixedView() {
    return this.compact || this.locked || Boolean(this.arrow);
  }

  setTargets(slots) {
    if (slots.join(',') === this.targetSlots.join(',')) return;
    this.targetSlots = slots;
    this.paint();
  }

  focusTargets() {
    if (!this.cube || !this.targetSlots.length) return;
    const { current, destinations } = targetPositions(this.cube, this.targetSlots);
    function score(camera) {
      const visible = piece => [...piece].some(face => dot(axes[face][0], camera.toward) > 0.22);
      return current.filter(visible).length * 5 + destinations.filter(visible).length;
    }
    let best = score(this.camera());
    for (const { yaw } of previewViews) {
      for (const pitch of [0.48, -0.48]) {
        const candidate = score(cameraAt(yaw, pitch));
        if (candidate <= best) continue;
        this.yaw = yaw;
        this.pitch = pitch;
        best = candidate;
      }
    }
    this.paint();
  }

  show(cube, arrow, transition, locked = false) {
    if (arrow && !this.fixedView) {
      this.yaw = guideYaw;
      this.pitch = guidePitch;
    }
    this.cube = cube;
    this.state = cube.asString();
    this.arrow = arrow;
    this.locked = locked;
    this.canvas.toggleAttribute('data-fixed-view', this.fixedView);
    cancelAnimationFrame(this.frame);
    this.animation = null;
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const axis = axes[turnFace(transition?.move)]?.[0];
    if (!axis || reduceMotion) {
      this.paint();
      return;
    }
    const started = performance.now();
    const before = transition.before.asString();
    const { move } = transition;
    const turn = turnPower(move);
    const wholeCube = isCubeRotation(move);
    const wide = isWideTurn(move);
    const fullAngle = (turn === 3 ? 1 : -turn) * Math.PI / 2;
    const animate = time => {
      const t = Math.min(1, (time - started) / 226);
      this.animation = t < 1 ? { before, cube: transition.before, guided: transition.guided, axis, wholeCube, wide, angle: fullAngle * (1 - (1 - t) ** 3) } : null;
      this.paint();
      if (t < 1) this.frame = requestAnimationFrame(animate);
    };
    this.frame = requestAnimationFrame(animate);
  }

  camera() {
    if (this.fixedView || this.animation?.guided) return guideCamera;
    const camera = cameraAt(this.yaw, this.pitch);
    if (!this.orientation) return camera;
    // Use the inverse of the cube's relative rotation to keep projecting in cube coordinates.
    const [x, y, z, w] = this.orientation;
    const inverse = [-x, -y, -z, w];
    const toCube = v => rotateByQuaternion(rotateByQuaternion(v, this.referenceOrientation), inverse);
    return { toward: toCube(camera.toward), right: toCube(camera.right), up: toCube(camera.up) };
  }

  paint() {
    if (!this.state) return;
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    const ratio = Math.min(2.5, devicePixelRatio || 1);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const context = this.context;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const camera = this.camera();
    const unit = Math.min(width / (this.compact ? 5.8 : 6.0), height / (this.compact ? 5.1 : 6.15)) * this.zoom;
    const centerX = width / 2;
    const centerY = height * (this.compact ? 0.5 : 0.47);
    const project = v => [centerX + dot(v, camera.right) * unit, centerY - dot(v, camera.up) * unit];
    if (!this.compact) {
      context.save();
      context.translate(centerX + 4, centerY + unit * 2.16);
      context.scale(1, 0.24);
      const shadow = context.createRadialGradient(0, 0, 0, 0, 0, unit * 2.65);
      shadow.addColorStop(0, '#020509e8');
      shadow.addColorStop(1, '#02050900');
      context.fillStyle = shadow;
      context.fillRect(-unit * 3, -unit * 3, unit * 6, unit * 6);
      context.restore();
    }

    const state = this.animation?.before ?? this.state;
    const layer = this.animation ? null : axes[turnFace(this.arrow)]?.[0];
    const arrowHidden = layer && dot(layer, camera.toward) < 0;
    const wideGuide = isWideTurn(this.arrow);
    const guideLayer = arrowHidden || wideGuide ? layer : null;
    let markers;
    if (this.targetSlots.length) {
      const { current, destinations } = targetPositions(this.animation?.cube ?? this.cube, this.targetSlots);
      const keys = positions => new Set(positions.map(piece => pieceCoordinates(piece).join(',')));
      markers = { pieces: keys(current), slots: keys(destinations) };
    }
    drawCube(context, state, camera, project, { animation: this.animation, guideLayer, wideGuide, markers });
    if (arrowHidden) this.drawHiddenArrow(context, layer, camera, project, unit);
    else if (layer) this.drawArrow(context, project, unit);
  }

  drawHiddenArrow(context, normal, camera, project, unit) {
    // Follow the two exposed strips of this layer around their shared corner.
    let [first, second] = Object.values(axes).map(([axis]) => axis)
      .filter(axis => dot(axis, normal) === 0 && dot(axis, camera.toward) > 0);
    if (dot(cross(first, second), normal) > 0) [first, second] = [second, first];
    const point = (a, b) => project(add(normal, add(scale(first, a), scale(second, b))));
    const extent = this.arrow[1] === '2' ? 1.25 : 0.55;
    const path = [point(1.51, -extent), point(1.51, 1.51), point(-extent, 1.51)];
    if (this.arrow[1] === "'") path.reverse();
    this.strokeArrow(context, path, unit);
  }

  drawArrow(context, project, unit) {
    const [normal, across, down] = axes[turnFace(this.arrow)];
    const direction = this.arrow[1] === "'" ? -1 : 1;
    const origin = scale(normal, 1.535);
    const arc = Array.from({ length: 34 }, (_, index) => {
      const theta = -1.16 + direction * index / 33 * (this.arrow[1] === '2' ? 5.65 : 4.14);
      return project(add(origin, add(scale(across, Math.cos(theta) * 1.067), scale(down, Math.sin(theta) * 1.067))));
    });
    this.strokeArrow(context, arc, unit);
  }

  strokeArrow(context, arc, unit) {
    const tip = arc.at(-1);
    const end = arc.at(-2);
    const directionRadians = Math.atan2(tip[1] - end[1], tip[0] - end[0]);
    const weight = Math.max(2.6, unit * 0.076);
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const outline of [true, false]) {
      context.beginPath();
      context.moveTo(...arc[0]);
      arc.slice(1).forEach(point => context.lineTo(...point));
      const size = weight * 2.65;
      context.moveTo(tip[0] - size * Math.cos(directionRadians - 0.59), tip[1] - size * Math.sin(directionRadians - 0.59));
      context.lineTo(...tip);
      context.lineTo(tip[0] - size * Math.cos(directionRadians + 0.59), tip[1] - size * Math.sin(directionRadians + 0.59));
      context.strokeStyle = outline ? '#1a1823e8' : '#fff3c4';
      context.lineWidth = weight + (outline ? 3.4 : 0);
      context.stroke();
    }
    context.restore();
  }
}
