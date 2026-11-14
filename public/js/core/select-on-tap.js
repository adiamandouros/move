// A field holding a choice (a station or a place picked, My location) has its
// words selected by the tap that brings the focus to it, so typing replaces
// them, as on the Subway and Trip pages' fields. A tap in it once it has the
// focus places the cursor where it lands, to edit them: Android's browser
// keeps a selection tapped inside, so it's let go of as the tap starts. On a
// tap, not on focus: the focus comes back to the field from its list, and a
// tap's own press would undo a selection made as the field takes the focus.
// The keyboard's Tab selects it by itself.
export function selectOnFirstTap(input, holdsChoice) {
    let hadFocus = false;
    input.addEventListener('pointerdown', () => {
        hadFocus = document.activeElement === input;
        if (hadFocus && input.selectionStart !== input.selectionEnd) input.setSelectionRange(input.selectionEnd, input.selectionEnd);
    });
    input.addEventListener('click', () => {
        if (!hadFocus && holdsChoice()) input.select();
        hadFocus = false;
    });
}
