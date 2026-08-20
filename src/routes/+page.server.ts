import { env } from "$env/dynamic/private";

export function load() {
  return { cpe: env.EREDES_CPE ?? "" };
}
