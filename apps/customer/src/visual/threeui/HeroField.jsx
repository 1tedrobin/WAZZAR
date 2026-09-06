import { ConstellationField } from "@designcodeio/threeui";
import "@designcodeio/threeui/style.css";

// Pure presentational — receives its look via props, fetches nothing,
// knows nothing about auth/screens/navigation. Tuned low-key on purpose:
// this sits behind the WAZZAR splash wordmark, not in front of it.
export default function HeroField() {
  return (
    <ConstellationField
      mode="dark"
      speed={0.35}
      size={0.8}
      strokeWidth={0.8}
      length={0.9}
      density={0.55}
      opacity={0.5}
      hue={28}       // WAZZAR amber
      saturation={0.85}
      brightness={0.9}
    />
  );
}
