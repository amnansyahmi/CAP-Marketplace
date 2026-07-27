/**
 * The Chef Ammar catalogue.
 *
 * Weight, nutrition and the Malay heritage copy are transcribed from the
 * physical jar labels; `accent` is sampled from each label's colour band so the
 * product tint on site matches the packaging.
 *
 * This module is the single source of truth for pricing — the order API
 * recomputes every total from here rather than trusting figures posted by the
 * browser.
 */

export type Nutrition = {
  servingSize: string;
  energyKcal: number;
  energyKj: number;
  carbohydrate: string;
  protein: string;
  fat: string;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  arabic: string;
  /** Short line used on cards. */
  tagline: string;
  /** Full paragraph used on the product page and quick view. */
  description: string;
  price: number;
  weightGrams: number;
  image: string;
  accent: string;
  tags: string[];
  servingSuggestions: string[];
  nutrition: Nutrition;
};

/** Printed identically on all three labels. */
const LABEL_NUTRITION: Nutrition = {
  servingSize: "100g",
  energyKcal: 264,
  energyKj: 1109,
  carbohydrate: "33.4g",
  protein: "2.5g",
  fat: "13.4g",
};

/** The heritage note carried on every jar. */
export const HERITAGE_NOTE =
  "Rempah ratus asli Timur Tengah warisan dari ibu saya yang telah menggunakan resipi ini dalam masakan kegemaran keluarga. Beberapa generasi sebelumnya.";

export const BRAND_TAGLINE = "Masak Dari Hati, Masak Dengan Iman";

export const products: Product[] = [
  {
    id: "kabsah",
    slug: "kabsah-paste",
    name: "Kabsah Paste",
    arabic: "كبسة",
    tagline: "Tomato-forward, aromatic and warmly spiced.",
    description:
      "A balanced Saudi-style rice paste with warm spices and a gentle tomato richness. Built for fuss-free home cooking while keeping the flavour layered and fragrant.",
    price: 19.9,
    weightGrams: 350,
    image: "/products/kabsah.webp",
    accent: "#903008",
    tags: ["Warm spice", "Family favourite"],
    servingSuggestions: ["Chicken kabsah", "Lamb over basmati", "Roast vegetables"],
    nutrition: LABEL_NUTRITION,
  },
  {
    id: "mandy",
    slug: "mandy-paste",
    name: "Mandy Paste",
    arabic: "مندي",
    tagline: "Smoky, fragrant and delicately spiced.",
    description:
      "A fragrant Yemeni-inspired blend made for fluffy basmati rice, roast chicken and an unmistakable smoky finish.",
    price: 19.9,
    weightGrams: 350,
    image: "/products/mandy.webp",
    accent: "#502008",
    tags: ["Smoky", "Light spice"],
    servingSuggestions: ["Smoked chicken mandy", "Slow-roast lamb", "Rice pilaf"],
    nutrition: LABEL_NUTRITION,
  },
  {
    id: "briyani",
    slug: "briyani-paste",
    name: "Briyani Paste",
    arabic: "برياني",
    tagline: "Rich spice, deep aroma and full-bodied flavour.",
    description:
      "A bold, aromatic briyani paste that brings together toasted spice, savoury depth and an inviting golden colour.",
    price: 19.9,
    weightGrams: 350,
    image: "/products/briyani.webp",
    accent: "#600808",
    tags: ["Bold aroma", "Celebration rice"],
    servingSuggestions: ["Chicken briyani", "Beef dum briyani", "Festive rice"],
    nutrition: LABEL_NUTRITION,
  },
];

export const productById = (id: string) => products.find((p) => p.id === id);
export const productBySlug = (slug: string) => products.find((p) => p.slug === slug);

/** Cheapest jar in the range — drives the "from RM x" line in the hero. */
export const startingPrice = () => Math.min(...products.map((p) => p.price));
