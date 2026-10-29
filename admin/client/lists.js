// Things the station editor records several of, like a platform's elevators
// or a station's exits: a fieldset for each ("Elevator 1", "Elevator 2"…)
// with its own fields and a Remove button, and a button that adds one.

let ids = 0;

// A labelled field in `parent`: a text box, with `list` the id of a
// <datalist> of suggestions, or with `options` ([value, text] pairs) a
// drop-down. `check(value)` gives a hint to show under it ('' for none, `{
// warn }` for one worth a look), and `error(value)` what's wrong with it,
// which stops a save as the browser's own checks do; both are updated as
// it's typed. `wide`: on a line of its own (a long name).
export function field(parent, label, value, { options, list, check, error, required = false, wide = false } = {}) {
    const id = `list-field-${++ids}`;
    const wrap = document.createElement('div');
    wrap.className = wide ? 'list-field list-field-wide' : 'list-field';
    const text = document.createElement('label');
    text.className = 'form-label';
    text.htmlFor = id;
    text.textContent = label;

    let input;
    if (options) {
        input = document.createElement('select');
        input.className = 'form-select';
        input.append(...options.map(([v, t]) => new Option(t, v, false, v === value)));
    } else {
        input = document.createElement('input');
        input.className = 'form-control';
        input.value = value ?? '';
        if (list) input.setAttribute('list', list);
    }
    input.id = id;
    input.required = required;
    wrap.append(text, input);

    if (check || error) {
        const hint = document.createElement('div');
        hint.id = `${id}-hint`;
        hint.className = 'list-hint';
        input.setAttribute('aria-describedby', hint.id);
        const update = () => {
            const problem = error?.(input.value) ?? '';
            input.setCustomValidity(problem);
            const said = problem ? { warn: problem } : check?.(input.value) ?? '';
            hint.textContent = typeof said === 'string' ? said : said.warn;
            hint.classList.toggle('list-hint-warn', typeof said !== 'string');
        };
        input.addEventListener('input', update);
        update();
        wrap.append(hint);
    }
    parent.append(wrap);
    return input;
}

// Checkboxes in `parent` under `legend`, one per [value, text] of `options`,
// ticked when `selected` has it. → a function reading the ticked values
export function checks(parent, legend, options, selected = []) {
    const set = document.createElement('fieldset');
    set.className = 'list-checks';
    const title = document.createElement('legend');
    title.textContent = legend;
    const boxes = options.map(([value, text]) => {
        const id = `list-field-${++ids}`;
        const wrap = document.createElement('div');
        wrap.className = 'form-check form-check-inline';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'form-check-input';
        box.id = id;
        box.value = value;
        box.checked = selected.includes(value);
        const label = document.createElement('label');
        label.className = 'form-check-label';
        label.htmlFor = id;
        label.textContent = text;
        wrap.append(box, label);
        return wrap;
    });
    set.append(title, ...boxes);
    parent.append(set);
    return () => [...set.querySelectorAll('input:checked')].map(box => box.value);
}

// The rows in `container`, one per thing called `thing` ("Elevator"),
// `addButton` adding one. `build(fields, item)` puts a row's fields for
// `item` in `fields` and returns a function reading them back.
export function rowList(container, addButton, thing, build) {
    let rows = [];

    const renumber = () => rows.forEach((r, i) => {
        r.legend.textContent = `${thing} ${i + 1}`;
        r.remove.setAttribute('aria-label', `Remove ${thing.toLowerCase()} ${i + 1}`);
    });

    function add(item = {}) {
        const row = document.createElement('fieldset');
        row.className = 'list-row';
        const legend = document.createElement('legend');
        const fields = document.createElement('div');
        fields.className = 'list-fields';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-sm btn-outline-secondary';
        remove.textContent = 'Remove';
        const read = build(fields, item);
        fields.append(remove);
        row.append(legend, fields);

        const entry = { legend, remove, read };
        remove.addEventListener('click', () => {
            rows = rows.filter(r => r !== entry);
            row.remove();
            renumber();
            // Its button is gone: on to the one that adds
            addButton.focus();
        });
        rows.push(entry);
        container.append(row);
        renumber();
        return row;
    }

    addButton.addEventListener('click', () => add().querySelector('input, select')?.focus());

    return {
        set(items) {
            rows = [];
            container.replaceChildren();
            items.forEach(item => add(item));
        },
        add,
        read: () => rows.map(r => r.read()),
        get size() { return rows.length; },
    };
}
