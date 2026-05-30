import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "$20 a Day",
    short_name: "$20 a Day",
    description: "Our shared daily allowance bank",
    start_url: "/",
    display: "standalone",
    background_color: "#ecfdf5",
    theme_color: "#ecfdf5",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
