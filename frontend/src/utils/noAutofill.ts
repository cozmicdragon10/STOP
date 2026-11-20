// Browsers (Edge especially) see a client's name, ID # and address and offer to save them as the staff member's own
// details: a driver's license, an address, a contact card. Client information must never end up stored in the
// browser, so every form and field is marked autocomplete="off". A field that already sets autocomplete (the login
// email and password, the device sign-in) keeps its own value, so saved logins still work.
const UNMARKED = 'form:not([autocomplete]), input:not([autocomplete]), textarea:not([autocomplete]), select:not([autocomplete])';

function markFields(root: ParentNode) {
  if (root instanceof Element && root.matches(UNMARKED)) root.setAttribute('autocomplete', 'off');
  root.querySelectorAll(UNMARKED).forEach(el => el.setAttribute('autocomplete', 'off'));
}

// Marks what's on the page now and anything React adds later (forms that open, tabs that load)
export function turnOffBrowserAutofill(root: HTMLElement = document.body) {
  markFields(root);
  new MutationObserver(mutations => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => { if (node instanceof Element) markFields(node); });
    }
  }).observe(root, { childList: true, subtree: true });
}
