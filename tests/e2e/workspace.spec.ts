import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("independent windows move, resize, persist and fit a smaller desktop", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const rack = page.locator('[data-window="rack"]');
  const playlist = page.locator('[data-window="playlist"]');
  await expect(rack).toBeVisible();
  await page.keyboard.press("F5");
  await expect(playlist).toHaveClass(/focused/);
  await page.keyboard.press("F6");
  const old = (await rack.boundingBox())!;
  const title = (await rack.locator(".window-titlebar").boundingBox())!;
  await page.mouse.move(title.x + 300, title.y + 12);
  await page.mouse.down();
  await page.mouse.move(title.x + 380, title.y + 87, { steps: 5 });
  await page.mouse.up();
  const moved = (await rack.boundingBox())!;
  expect(moved.x).toBeGreaterThan(old.x + 60);
  expect(moved.y).toBeGreaterThan(old.y + 60);
  const handle = (await rack.locator(".window-resize").boundingBox())!;
  await page.mouse.move(handle.x + 8, handle.y + 8);
  await page.mouse.down();
  await page.mouse.move(handle.x - 72, handle.y + 45, { steps: 5 });
  await page.mouse.up();
  const resized = (await rack.boundingBox())!;
  expect(resized.width).toBeLessThan(moved.width - 65);
  expect(resized.height).toBeGreaterThan(moved.height + 20);
  await page.keyboard.press("F6");
  await expect(rack).toBeHidden();
  await page.keyboard.press("F6");
  await expect(rack).toBeVisible();
  await page.reload();
  const restored = (await rack.boundingBox())!;
  expect(restored.x).toBeCloseTo(resized.x, 0);
  expect(restored.width).toBeCloseTo(resized.width, 0);
  await page.setViewportSize({ width: 1080, height: 740 });
  await expect
    .poll(async () => {
      const b = (await rack.boundingBox())!;
      return b.x + b.width;
    })
    .toBeLessThanOrEqual(1081);
  const small = (await rack.boundingBox())!;
  expect(small.y + small.height).toBeLessThanOrEqual(719);
  await page
    .getByRole("button", { name: "Restablecer ventanas", exact: true })
    .click();
  await expect(playlist).toBeVisible();
  expect(errors).toEqual([]);
});

test("channel context actions fill, copy, paste and undo real sequencer data", async ({
  page,
}) => {
  await page.goto("/");
  const names = page.locator(".rack-name");
  await names.nth(0).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Rellenar cada 2 pasos", exact: true })
    .click();
  const first = page.locator(".rack-row").nth(0);
  await expect(first.locator('.step-button[aria-pressed="true"]')).toHaveCount(
    16,
  );
  await names.nth(0).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Copiar canal", exact: true })
    .click();
  await names.nth(1).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Pegar canal", exact: true })
    .click();
  const second = page.locator(".rack-row").nth(1);
  await expect(second.locator('.step-button[aria-pressed="true"]')).toHaveCount(
    16,
  );
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(second.locator('.step-button[aria-pressed="true"]')).toHaveCount(
    4,
  );
  const gain = page.getByLabel("Rack, volumen de Deep kick", { exact: true });
  await gain.focus();
  await page.keyboard.press("Home");
  await expect(gain).toHaveValue("0");
});

test("pattern rename and browser drag place the dragged pattern rather than the active one", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("menuitem", { name: "PATRONES", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Clonar patrón", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "PATRONES", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Renombrar patrón…", exact: true })
    .click();
  await page
    .getByLabel("Nombre del patrón", { exact: true })
    .fill("Estribillo");
  await page
    .getByRole("button", { name: "Guardar nombre", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Seleccionar patrón Midnight groove",
      exact: true,
    })
    .click();
  await page.keyboard.press("F5");
  const source = page.getByRole("button", {
    name: "Seleccionar patrón Estribillo",
    exact: true,
  });
  const lane = page.locator(".playlist-row").nth(6).locator(".clip-lane");
  await source.dragTo(lane, { targetPosition: { x: 30, y: 24 } });
  await expect(
    page.getByRole("button", {
      name: "Velvet keys, Estribillo, compás 1",
      exact: true,
    }),
  ).toBeVisible();
  const saved = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const project = JSON.parse(
    (await readFile((await (await saved).path())!)).toString(),
  );
  const cloned = project.patterns.find((p: any) => p.name === "Estribillo");
  expect(cloned).toBeTruthy();
  expect(
    project.clips.some(
      (c: any) =>
        c.laneId === project.lanes[6].id &&
        c.scope === "pattern" &&
        c.startBar === 0 &&
        c.patternId === cloned.id,
    ),
  ).toBe(true);
});

test("piano editing, ghost notes and mixer effect slots share the workspace", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("F7");
  const piano = page.locator('[data-window="piano"]');
  await expect(piano).toBeVisible();
  await expect(page.locator(".ghost-note").first()).toBeAttached();
  const firstBefore = await piano
    .locator(".piano-note")
    .first()
    .getAttribute("aria-label");
  await page.keyboard.press("Control+ArrowUp");
  await expect(piano.locator(".piano-note").first()).not.toHaveAttribute(
    "aria-label",
    firstBefore!,
  );
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(piano.locator(".piano-note").first()).toHaveAttribute(
    "aria-label",
    firstBefore!,
  );
  const velocity = piano.locator(".velocity-lane input:not(:disabled)").first();
  await velocity.focus();
  await page.keyboard.press("Home");
  await expect(velocity).toHaveValue("0.05");
  const scrollPosition = await piano
    .locator(".piano-scroller")
    .evaluate((node) => node.scrollTop);
  await page.keyboard.press("F7");
  await expect(piano).toBeHidden();
  await page.keyboard.press("F7");
  await expect
    .poll(() =>
      piano.locator(".piano-scroller").evaluate((node) => node.scrollTop),
    )
    .toBe(scrollPosition);
  await page.screenshot({ path: "test-results/studiowav-0.3-piano.png" });
  await page.keyboard.press("F9");
  await expect(page.locator('[data-window="mixer"]')).toBeVisible();
  await expect(page.locator(".mixer-effect-slot")).toHaveCount(8);
  await page
    .getByRole("button", { name: "Añadir efecto en ranura 1", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Efectos VST3", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Cerrar estudio de audio" }).click();
  await page.keyboard.press("F7");
  await page.keyboard.press("F7");
  await page.keyboard.press("F6");
  await page.keyboard.press("F9");
  await page.screenshot({ path: "test-results/studiowav-0.3-workspace.png" });
});
