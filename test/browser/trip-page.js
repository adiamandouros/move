// The Trip page's fields, for the specs that plan a trip on it (trip.spec.js,
// offline.spec.js). The addresses are test/fixtures/places.js.

export const from = page => page.getByRole('combobox', { name: 'From' });
export const to = page => page.getByRole('combobox', { name: 'To' });
export const list = (page, name) => page.locator(`#trip-${name}-list [role="option"]`);

// From an address in Kallithea to Syggrou-Fix, on `url`
export async function pickBoth(page, url = '/trip') {
    await page.goto(url);
    await from(page).fill('Μενελάου 45');
    await list(page, 'from').first().click();
    await to(page).fill('Συγγρού-Φιξ');
    await list(page, 'to').first().click();
}
