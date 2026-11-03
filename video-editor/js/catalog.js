// Shared lists used by the UI (library, inspector) and the renderer.
// The renderer must implement every `id` listed in FILTERS and TRANSITIONS.

export const ASPECTS = [
  { id: '16:9', label: '16:9 Widescreen', w: 1920, h: 1080 },
  { id: '9:16', label: '9:16 Portrait (TikTok / Shorts)', w: 1080, h: 1920 },
  { id: '1:1', label: '1:1 Instagram', w: 1080, h: 1080 },
  { id: '4:5', label: '4:5 Instagram portrait', w: 1080, h: 1350 },
  { id: '4:3', label: '4:3 Standard', w: 1440, h: 1080 },
  { id: '21:9', label: '21:9 Cinema', w: 2560, h: 1080 },
  { id: 'custom', label: 'Custom', w: 0, h: 0 },
];

export const RESOLUTIONS = [
  { label: '480p', short: 480 }, { label: '720p', short: 720 }, { label: '1080p', short: 1080 },
  { label: '1440p', short: 1440 }, { label: '4K', short: 2160 },
];

export const FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 50, 60];

export const BLEND_MODES = [
  { id: 'normal', label: 'Normal' }, { id: 'multiply', label: 'Multiply' }, { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' }, { id: 'add', label: 'Add (Linear Dodge)' }, { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' }, { id: 'difference', label: 'Difference' }, { id: 'softlight', label: 'Soft Light' },
  { id: 'hardlight', label: 'Hard Light' }, { id: 'colordodge', label: 'Color Dodge' }, { id: 'colorburn', label: 'Color Burn' },
];

// Filter presets (look filters). `amount` 0..1 blends the look over the original.
export const FILTERS = [
  { id: 'grayscale', label: 'Black & White', category: 'Basic' },
  { id: 'sepia', label: 'Sepia', category: 'Basic' },
  { id: 'invert', label: 'Invert', category: 'Basic' },
  { id: 'vintage', label: 'Vintage', category: 'Film' },
  { id: 'warm', label: 'Warm', category: 'Color' },
  { id: 'cool', label: 'Cool', category: 'Color' },
  { id: 'teal_orange', label: 'Teal & Orange', category: 'Cinematic' },
  { id: 'noir', label: 'Noir', category: 'Cinematic' },
  { id: 'faded', label: 'Faded', category: 'Film' },
  { id: 'vivid', label: 'Vivid', category: 'Color' },
  { id: 'cyberpunk', label: 'Cyberpunk', category: 'Cinematic' },
  { id: 'duotone', label: 'Duotone', category: 'Color' },
  { id: 'pixelate', label: 'Pixelate', category: 'Stylize' },
  { id: 'posterize', label: 'Posterize', category: 'Stylize' },
  { id: 'glitch', label: 'Glitch (RGB split)', category: 'Stylize' },
  { id: 'vhs', label: 'VHS', category: 'Film' },
  { id: 'film_grain', label: 'Film Grain', category: 'Film' },
  { id: 'edge', label: 'Edge Detect', category: 'Stylize' },
  { id: 'emboss', label: 'Emboss', category: 'Stylize' },
  { id: 'mirror', label: 'Mirror', category: 'Distort' },
  { id: 'fisheye', label: 'Fisheye', category: 'Distort' },
  { id: 'wave', label: 'Wave', category: 'Distort' },
  { id: 'chromatic', label: 'Chromatic Aberration', category: 'Lens' },
  { id: 'bloom', label: 'Glow / Bloom', category: 'Lens' },
  { id: 'letterbox', label: 'Letterbox', category: 'Cinematic' },
  // ---- v2 additions ----
  { id: 'deep_fry', label: 'Deep Fried', category: 'Meme' },
  { id: 'shake', label: 'Camera Shake', category: 'Meme' },
  { id: 'earthquake', label: 'Earthquake', category: 'Meme' },
  { id: 'rgb_shake', label: 'RGB Shake', category: 'Meme' },
  { id: 'drunk', label: 'Drunk (double vision)', category: 'Meme' },
  { id: 'zoom_pulse', label: 'Bass Zoom Pulse', category: 'Meme' },
  { id: 'rainbow', label: 'Rainbow Cycle', category: 'Meme' },
  { id: 'thermal', label: 'Thermal Camera', category: 'Color' },
  { id: 'night_vision', label: 'Night Vision', category: 'Color' },
  { id: 'xray', label: 'X-Ray', category: 'Color' },
  { id: 'color_pop', label: 'Color Pop (keep reds)', category: 'Color' },
  { id: 'sketch', label: 'Pencil Sketch', category: 'Stylize' },
  { id: 'halftone', label: 'Halftone Dots', category: 'Stylize' },
  { id: 'dither', label: '1-bit Dither', category: 'Stylize' },
  { id: 'oil_paint', label: 'Oil Paint', category: 'Stylize' },
  { id: 'neon_edges', label: 'Neon Edges', category: 'Stylize' },
  { id: 'mosaic', label: 'Mosaic Tiles', category: 'Stylize' },
  { id: 'crt', label: 'CRT Scanlines', category: 'Film' },
  { id: 'old_film', label: 'Old Film (scratches)', category: 'Film' },
  { id: 'kaleidoscope', label: 'Kaleidoscope', category: 'Distort' },
  { id: 'bulge', label: 'Bulge', category: 'Distort' },
  { id: 'pinch', label: 'Pinch', category: 'Distort' },
  { id: 'twirl', label: 'Twirl', category: 'Distort' },
  { id: 'tilt_shift', label: 'Tilt Shift', category: 'Lens' },
  { id: 'zoom_blur', label: 'Zoom Blur', category: 'Lens' },
  { id: 'motion_blur', label: 'Motion Blur', category: 'Lens' },
];

// Transitions. The renderer gets progress 0..1 (0 = all `other`, 1 = all `clip`).
export const TRANSITIONS = [
  { id: 'dissolve', label: 'Dissolve', category: 'Basic' },
  { id: 'fade_black', label: 'Fade (Dip to Black)', category: 'Basic' },
  { id: 'fade_white', label: 'Flash (Dip to White)', category: 'Basic' },
  { id: 'wipe_left', label: 'Wipe Left', category: 'Wipe' },
  { id: 'wipe_right', label: 'Wipe Right', category: 'Wipe' },
  { id: 'wipe_up', label: 'Wipe Up', category: 'Wipe' },
  { id: 'wipe_down', label: 'Wipe Down', category: 'Wipe' },
  { id: 'slide_left', label: 'Slide Left', category: 'Slide' },
  { id: 'slide_right', label: 'Slide Right', category: 'Slide' },
  { id: 'push_left', label: 'Push Left', category: 'Slide' },
  { id: 'push_up', label: 'Push Up', category: 'Slide' },
  { id: 'zoom_in', label: 'Zoom In', category: 'Zoom' },
  { id: 'zoom_out', label: 'Zoom Out', category: 'Zoom' },
  { id: 'circle_open', label: 'Circle Open', category: 'Shape' },
  { id: 'circle_close', label: 'Circle Close', category: 'Shape' },
  { id: 'diamond', label: 'Diamond', category: 'Shape' },
  { id: 'blinds', label: 'Blinds', category: 'Shape' },
  { id: 'col_split', label: 'Col Split', category: 'Shape' },
  { id: 'pixelize', label: 'Pixelize', category: 'Stylize' },
  { id: 'blur_dissolve', label: 'Blur Dissolve', category: 'Stylize' },
  { id: 'fade_grayscale', label: 'Fade Grayscale', category: 'Stylize' },
  { id: 'ripple', label: 'Ripple', category: 'Warp' },
  { id: 'swirl', label: 'Swirl', category: 'Warp' },
  { id: 'spin', label: 'Spin', category: 'Warp' },
  { id: 'glitch', label: 'Glitch', category: 'Stylize' },
  // ---- v2 additions ----
  { id: 'cube_left', label: 'Cube Spin Left', category: '3D' },
  { id: 'cube_right', label: 'Cube Spin Right', category: '3D' },
  { id: 'cube_up', label: 'Cube Spin Up', category: '3D' },
  { id: 'flip_card', label: 'Card Flip', category: '3D' },
  { id: 'door_open', label: 'Doors Open', category: '3D' },
  { id: 'page_turn', label: 'Page Turn', category: '3D' },
  { id: 'white_flash', label: 'White Flash', category: 'Meme' },
  { id: 'flashbang', label: 'Flashbang', category: 'Meme' },
  { id: 'zoom_punch', label: 'Zoom Punch', category: 'Meme' },
  { id: 'spin_zoom', label: 'Spin Zoom', category: 'Meme' },
  { id: 'star_wipe', label: 'Star Wipe', category: 'Meme' },
  { id: 'heart_wipe', label: 'Heart Wipe', category: 'Meme' },
  { id: 'shake_cut', label: 'Shake Cut', category: 'Meme' },
  { id: 'whip_pan', label: 'Whip Pan', category: 'Slide' },
  { id: 'bounce', label: 'Bounce In', category: 'Slide' },
  { id: 'clock_wipe', label: 'Clock Wipe', category: 'Wipe' },
  { id: 'radial_wipe', label: 'Radial Wipe', category: 'Wipe' },
  { id: 'cross_zoom', label: 'Cross Zoom', category: 'Zoom' },
  { id: 'film_burn', label: 'Film Burn', category: 'Stylize' },
  { id: 'luma_fade', label: 'Luma Fade', category: 'Basic' },
  { id: 'rgb_split', label: 'RGB Split', category: 'Stylize' },
  { id: 'mosaic_tiles', label: 'Mosaic Tiles', category: 'Stylize' },
  { id: 'dreamy', label: 'Dreamy Wave', category: 'Warp' },
];

export const FONTS = ['Inter', 'Arial', 'Impact', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Comic Sans MS', 'Bebas Neue', 'Montserrat', 'Poppins', 'Roboto', 'Oswald', 'Permanent Marker', 'Bangers'];
export const WEB_FONTS = ['Bebas Neue', 'Montserrat', 'Poppins', 'Roboto', 'Oswald', 'Permanent Marker', 'Bangers', 'Inter'];

export const TITLE_PRESETS = [
  { id: 'basic', label: 'Basic Title', text: { content: 'Title', font: 'Inter', size: 110, color: '#ffffff', bold: true, stroke: 0, shadow: true } },
  { id: 'subtitle', label: 'Subtitle', text: { content: 'Subtitle text', font: 'Inter', size: 56, color: '#ffffff', bold: false, stroke: 0, background: 'rgba(0,0,0,0.6)', shadow: false }, y: 0.38 },
  { id: 'meme', label: 'Meme Impact', text: { content: 'TOP TEXT', font: 'Impact', size: 130, color: '#ffffff', bold: false, stroke: 8, strokeColor: '#000000', shadow: false }, y: -0.38 },
  { id: 'youtube', label: 'Thumbnail Pop', text: { content: 'NO WAY!', font: 'Bangers', size: 160, color: '#ffe600', bold: false, stroke: 10, strokeColor: '#000000', shadow: true } },
  { id: 'lower', label: 'Lower Third', text: { content: 'Name Surname', font: 'Montserrat', size: 64, color: '#ffffff', bold: true, background: '#18d5b7', shadow: false, align: 'left' }, x: -0.3, y: 0.32 },
  { id: 'cinema', label: 'Cinematic', text: { content: 'CHAPTER ONE', font: 'Bebas Neue', size: 140, color: '#f2f2f2', bold: false, shadow: true } },
  { id: 'handwritten', label: 'Marker', text: { content: 'thanks for watching', font: 'Permanent Marker', size: 120, color: '#ffffff', stroke: 6, strokeColor: '#111111', shadow: true } },
];

export const SAMPLE_COLORS = ['#000000', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#30b0ff', '#2a6df4', '#5856d6', '#af52de', '#ff2d55', '#00ff00', '#0000ff', '#8e8e93', '#1c1c1e'];
