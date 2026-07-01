// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Quick view-switch buttons for the checking roster.
 *
 * Adds a three-button group (All / Not yet checked / Checked) above the
 * roster table so invigilators can switch between views with a single tap
 * rather than adding and removing datafilter chips.
 *
 * The filter is applied client-side by toggling row visibility, so it
 * survives live-poll refreshes and table reloads without disturbing the
 * server-side datafilter chip state or the keyword search.
 *
 * "Not yet checked" shows rows where at least one step toggle is unchecked.
 * "Checked"         shows rows where every step toggle is checked.
 * "All students"    removes the client-side overlay and shows all rows.
 *
 * @module     mod_examcheck/roster_quickfilter
 * @copyright  2026 André Camacho
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {get_strings as getStrings} from 'core/str';
import * as DynamicTable from 'core_table/dynamic';
import Notification from 'core/notification';

/** @type {string} Active quick-filter value: 'all' | 'notchecked' | 'checked'. */
let activeFilter = 'all';

/** @type {MutationObserver|null} Observer tracking data-checked attribute changes. */
let toggleObserver = null;

/**
 * Initialise the quick-filter bar for the given activity.
 *
 * @param {Number} cmid Course module id.
 */
export const init = async (cmid) => {
    const root = document.querySelector(`[data-region="examcheck-dashboard"][data-cmid="${cmid}"]`);
    const container = root ? root.querySelector('[data-region="examcheck-quickfilter"]') : null;
    if (!root || !container) {
        return;
    }

    try {
        const [labelAll, labelNotChecked, labelChecked, labelGroup] = await getStrings([
            {key: 'quickfilterall',        component: 'mod_examcheck'},
            {key: 'quickfilternotchecked', component: 'mod_examcheck'},
            {key: 'quickfilterchecked',    component: 'mod_examcheck'},
            {key: 'quickfiltergroup',      component: 'mod_examcheck'},
        ]);

        buildButtonGroup(container, labelAll, labelNotChecked, labelChecked, labelGroup);
        bindButtons(container, root);
        observeToggleChanges(root);

        // Re-apply after every dynamic-table AJAX reload (live poll, filter change, sort).
        root.addEventListener(DynamicTable.Events.tableContentRefreshed, () => {
            applyFilter(root, container);
        });
    } catch (e) {
        Notification.exception(e);
    }
};

/**
 * Build and insert the Bootstrap button group into the container.
 *
 * @param {HTMLElement} container       The target div.
 * @param {String}      labelAll        Localised label for "All students".
 * @param {String}      labelNotChecked Localised label for "Not yet checked".
 * @param {String}      labelChecked    Localised label for "Checked".
 * @param {String}      labelGroup      Localised accessible name for the button group.
 */
const buildButtonGroup = (container, labelAll, labelNotChecked, labelChecked, labelGroup) => {
    const group = document.createElement('div');
    group.className = 'btn-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', labelGroup);

    const buttons = [
        {value: 'all',        label: labelAll,        active: true},
        {value: 'notchecked', label: labelNotChecked, active: false},
        {value: 'checked',    label: labelChecked,    active: false},
    ];

    buttons.forEach(({value, label, active}) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn ' + (active ? 'btn-secondary' : 'btn-outline-secondary');
        btn.dataset.quickfilter = value;
        btn.textContent = label;
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        group.appendChild(btn);
    });

    container.appendChild(group);
};

/**
 * Bind click events on the button group.
 *
 * @param {HTMLElement} container The container holding the button group.
 * @param {HTMLElement} root      The dashboard region.
 */
const bindButtons = (container, root) => {
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-quickfilter]');
        if (!btn) {
            return;
        }
        activeFilter = btn.dataset.quickfilter;

        container.querySelectorAll('[data-quickfilter]').forEach((b) => {
            const isActive = b === btn;
            b.classList.toggle('btn-secondary', isActive);
            b.classList.toggle('btn-outline-secondary', !isActive);
            b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        applyFilter(root, container);
    });
};

/**
 * Apply the current activeFilter to all roster rows by toggling visibility.
 *
 * @param {HTMLElement} root      The dashboard region.
 * @param {HTMLElement} container The container holding the button group.
 */
const applyFilter = (root, container) => {
    root.querySelectorAll('.examcheck-roster tbody tr').forEach((row) => {
        const toggles = Array.from(row.querySelectorAll('[data-action="examcheck-toggle"]'));

        // Rows without any toggle (e.g. "no students" notice row) are always visible.
        if (!toggles.length) {
            row.hidden = false;
            return;
        }

        const allChecked   = toggles.every((t) => t.dataset.checked === '1');
        const anyUnchecked = toggles.some((t)  => t.dataset.checked === '0');

        switch (activeFilter) {
            case 'notchecked':
                row.hidden = !anyUnchecked;
                break;
            case 'checked':
                row.hidden = !allChecked;
                break;
            default: // 'all'
                row.hidden = false;
        }
    });

    updateCounter(root, container);
};

/**
 * Update the visible/total counter shown next to the button group.
 *
 * The counter is only rendered when a filter is active so it does not
 * clutter the UI under normal "All students" browsing.
 *
 * @param {HTMLElement} root      The dashboard region.
 * @param {HTMLElement} container The container holding the button group.
 */
const updateCounter = (root, container) => {
    let counter = container.querySelector('.examcheck-quickfilter-count');

    if (activeFilter === 'all') {
        if (counter) {
            counter.remove();
        }
        return;
    }

    const rows = root.querySelectorAll('.examcheck-roster tbody tr');
    let total   = 0;
    let visible = 0;
    rows.forEach((row) => {
        if (row.querySelectorAll('[data-action="examcheck-toggle"]').length) {
            total++;
            if (!row.hidden) {
                visible++;
            }
        }
    });

    if (!counter) {
        counter = document.createElement('span');
        counter.className = 'examcheck-quickfilter-count ms-2 text-muted small align-self-center';
        container.appendChild(counter);
    }
    counter.textContent = `${visible} / ${total}`;
};

/**
 * Watch for data-checked attribute mutations so the overlay stays correct
 * when checker.js marks or unmarks a student without triggering a full
 * table reload (i.e. when no server-side checkstatus filter is active).
 *
 * @param {HTMLElement} root The dashboard region.
 */
const observeToggleChanges = (root) => {
    if (toggleObserver) {
        toggleObserver.disconnect();
    }

    const container = root.querySelector('[data-region="examcheck-quickfilter"]');

    toggleObserver = new MutationObserver((mutations) => {
        const relevant = mutations.some(
            (m) => m.type === 'attributes' && m.attributeName === 'data-checked'
        );
        if (relevant) {
            applyFilter(root, container);
        }
    });

    toggleObserver.observe(root, {
        subtree:         true,
        attributes:      true,
        attributeFilter: ['data-checked'],
    });
};
