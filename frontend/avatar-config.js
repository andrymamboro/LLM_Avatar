// Configuration for Live2D/Live3D Avatar Settings
// You can edit these values to customize the avatar's behavior without editing the main JS bundle.

window.AVATAR_CONFIG = {
  // Lip Sync settings (gerakan mulut)
  lipSync: {
    // Multiplier for voice volume. Higher values make the mouth open wider.
    // Default is 3.5. Increase if mouth movement is too subtle, decrease if too wide.
    multiplier: 3.5
  },

  // Avatar Camera settings (kamera webcam)
  camera: {
    width: 320,
    height: 240
  },

  // Physical motion / body animation settings
  motion: {
    // You can define other animation factors here in the future
    idleSpeedFactor: 1.0,
    pointerSensitivity: 1.0
  }
};
