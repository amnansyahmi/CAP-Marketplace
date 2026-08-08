import next from "eslint-config-next";

/**
 * `next lint` was removed in Next.js 16. The `lint` script still called it, so
 * it exited 0 without linting a single file — a check that always passes is
 * worse than no check. This is the flat config ESLint 9 actually reads.
 */
const config = [
  { ignores: [".next/**", "node_modules/**", ".data/**", ".data-suspect/**", "public/**"] },

  ...next,

  {
    /**
     * React Three Fiber's API *is* mutation.
     *
     * `useThree` hands back the live camera and `useLoader` the live texture;
     * setting `camera.position.z` or `texture.wrapS` is how you drive them, and
     * `useFrame` runs outside React's render entirely, which is the whole point
     * of writing rotation to a ref instead of state. `react-hooks/immutability`
     * reads all of that as modifying a hook's return value.
     *
     * Scoped to the 3D components only, so the rule keeps working everywhere it
     * is telling the truth.
     */
    files: ["src/components/jar3d/**"],
    rules: { "react-hooks/immutability": "off" },
  },
];

export default config;
