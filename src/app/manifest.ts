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
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
