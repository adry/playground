Things that belong to the floor rather than standing on it: dug holes, spoil
heaps, paths, kerbs, and the planting that dresses them.

Two rules everything here shares.

The scene's floor is ONE 400 unit plane at y = 0 (src/ghost/ground.js), opaque,
with a grid drawn into it by a shader patch. Anything below it is invisible
unless the plane is cut, and anything exactly on it z-fights.

The camera is orthographic and fixed at about 38 degrees, so a flat patch is
seen at a glancing angle and its shading, not its outline, is what reads.
