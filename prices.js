// Elysian Meats front-end: renders the price list from prices.csv, lets the
// visitor choose quantities, and builds an order email via mailto:. The
// contact email is assembled at runtime from character codes so scrapers that
// grep HTML for something@something.tld find nothing.

(function () {
    'use strict';

    // --- State --------------------------------------------------------------
    // Populated after prices.csv loads. Each item:
    //   { id, type, name, price, available (>=0 or Infinity), selected (0..10) }
    var items = [];

    // --- Email assembly (shared by contact display and order mailto) --------
    function contactEmail() {
        var user = String.fromCharCode(101, 108, 121, 115, 105, 97, 110, 109, 101, 97, 116, 115);
        var host = String.fromCharCode(103, 109, 97, 105, 108, 46, 99, 111, 109);
        return user + String.fromCharCode(64) + host;
    }

    function renderEmailLink() {
        var slot = document.getElementById('email-slot');
        if (!slot) return;
        var addr = contactEmail();
        var a = document.createElement('a');
        a.href = 'mailto:' + addr;
        a.textContent = addr;
        slot.textContent = '';
        slot.appendChild(a);
    }

    // --- CSV loading & parsing ---------------------------------------------
    function loadPrices() {
        var slot = document.getElementById('menu-sections');
        if (!slot) return;
        fetch('prices.csv?v=' + Date.now(), { cache: 'no-cache' })
            .then(function (resp) {
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return resp.text();
            })
            .then(function (text) { renderMenu(parseCSV(text), slot); })
            .catch(function (err) {
                console.error('Failed to load prices:', err);
                slot.innerHTML =
                    '<p class="menu-error">Price list is unavailable right now. ' +
                    'Please contact us for current pricing.</p>';
            });
    }

    // RFC 4180-ish parser: handles quoted fields, escaped quotes (""), CRLF.
    function parseCSV(text) {
        var rows = [];
        var row = [];
        var field = '';
        var inQuotes = false;
        for (var i = 0; i < text.length; i++) {
            var c = text[i];
            if (inQuotes) {
                if (c === '"') {
                    if (text[i + 1] === '"') { field += '"'; i++; }
                    else { inQuotes = false; }
                } else {
                    field += c;
                }
            } else {
                if (c === '"') { inQuotes = true; }
                else if (c === ',') { row.push(field); field = ''; }
                else if (c === '\r') { /* swallow; handled with \n */ }
                else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
                else { field += c; }
            }
        }
        if (field !== '' || row.length) { row.push(field); rows.push(row); }
        return rows;
    }

    // --- Menu rendering -----------------------------------------------------
    function renderMenu(rows, container) {
        if (rows.length < 2) { container.innerHTML = ''; return; }

        var header = rows[0].map(function (h) { return h.trim().toLowerCase(); });
        var iType = header.indexOf('type');
        var iName = header.indexOf('name');
        var iPrice = header.indexOf('price');
        var iQty = header.indexOf('quantity');
        if (iType < 0 || iName < 0 || iPrice < 0) {
            throw new Error('prices.csv must have columns: Type, Name, Price (and optionally Quantity)');
        }

        items = [];
        var order = [];
        var groups = Object.create(null);
        for (var r = 1; r < rows.length; r++) {
            var row = rows[r];
            if (row.every(function (cell) { return cell.trim() === ''; })) continue;
            var type = (row[iType] || '').trim();
            var name = (row[iName] || '').trim();
            var price = (row[iPrice] || '').trim();
            if (!type || !name) continue;

            // If no Quantity column exists, or the cell is blank/non-numeric,
            // treat as in-stock with no cap so the list degrades to its
            // original behavior.
            var available = Number.POSITIVE_INFINITY;
            if (iQty >= 0) {
                var raw = (row[iQty] || '').trim();
                if (raw !== '') {
                    var n = parseInt(raw, 10);
                    if (!isNaN(n)) available = n;
                }
            }

            var item = {
                id: 'item-' + items.length,
                type: type,
                name: name,
                price: price,
                available: available,
                selected: 0
            };
            items.push(item);
            if (!(type in groups)) { groups[type] = []; order.push(type); }
            groups[type].push(item);
        }

        var frag = document.createDocumentFragment();
        order.forEach(function (type) {
            var section = document.createElement('section');
            section.className = 'menu';
            var h2 = document.createElement('h2');
            h2.textContent = type;
            section.appendChild(h2);

            var ul = document.createElement('ul');
            ul.className = 'price-list';
            groups[type].forEach(function (item) { ul.appendChild(renderItem(item)); });
            section.appendChild(ul);
            frag.appendChild(section);
        });
        container.innerHTML = '';
        container.appendChild(frag);
    }

    function renderItem(item) {
        var li = document.createElement('li');

        var nameSpan = document.createElement('span');
        nameSpan.className = 'item-name';
        nameSpan.textContent = item.name;
        li.appendChild(nameSpan);

        var qtyCell = document.createElement('span');
        qtyCell.className = 'item-qty-cell';

        if (item.available <= 0) {
            var tag = document.createElement('span');
            tag.className = 'stock-tag';
            tag.textContent = 'Out of stock';
            qtyCell.appendChild(tag);
        } else {
            var select = document.createElement('select');
            select.className = 'qty-select';
            select.setAttribute('aria-label', 'Order quantity for ' + item.name);
            // User spec: dropdown up to 10. Quantity is never surfaced, so
            // always offer 0..10 regardless of the in-stock count.
            for (var n = 0; n <= 10; n++) {
                var opt = document.createElement('option');
                opt.value = String(n);
                opt.textContent = n === 0 ? '\u2014' : String(n); // em dash for 0
                select.appendChild(opt);
            }
            select.addEventListener('change', function (e) {
                item.selected = parseInt(e.target.value, 10) || 0;
            });
            qtyCell.appendChild(select);
        }
        li.appendChild(qtyCell);

        var priceSpan = document.createElement('span');
        priceSpan.className = 'price';
        priceSpan.textContent = item.price;
        li.appendChild(priceSpan);

        return li;
    }

    // --- Order form ---------------------------------------------------------
    function wireOrderButton() {
        var btn = document.getElementById('generate-order-btn');
        if (!btn) return;
        btn.addEventListener('click', openOrderForm);
    }

    function selectedItems() {
        return items.filter(function (i) { return i.selected > 0; });
    }

    function openOrderForm() {
        var container = document.getElementById('order-form-container');
        if (!container) return;

        container.innerHTML = '';
        container.hidden = false;

        var chosen = selectedItems();
        if (chosen.length === 0) {
            var msg = document.createElement('p');
            msg.className = 'order-message';
            msg.textContent = 'Please select a quantity for at least one item to generate an order.';
            container.appendChild(msg);
            container.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }

        var form = document.createElement('form');
        form.className = 'order-form';

        var h2 = document.createElement('h2');
        h2.textContent = 'Your Order';
        form.appendChild(h2);

        // Selection summary
        var summary = document.createElement('ul');
        summary.className = 'order-summary';
        chosen.forEach(function (item) {
            var li = document.createElement('li');
            var label = document.createElement('span');
            label.textContent = item.name + ' \u00d7 ' + item.selected;
            var sub = document.createElement('span');
            sub.className = 'order-summary-type';
            sub.textContent = item.type;
            var priceSpan = document.createElement('span');
            priceSpan.className = 'price';
            priceSpan.textContent = item.price;
            var left = document.createElement('span');
            left.className = 'order-summary-left';
            left.appendChild(label);
            left.appendChild(sub);
            li.appendChild(left);
            li.appendChild(priceSpan);
            summary.appendChild(li);
        });
        form.appendChild(summary);

        // Contact fields
        var fields = document.createElement('div');
        fields.className = 'order-fields';
        var nameInput = addField(fields, 'Name', 'order-name', 'text', 'name');
        var phoneInput = addField(fields, 'Phone', 'order-phone', 'tel', 'tel');
        var emailInput = addField(fields, 'Email', 'order-email', 'email', 'email');
        form.appendChild(fields);

        var actions = document.createElement('div');
        actions.className = 'order-actions';
        var submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'btn-primary';
        submit.textContent = 'Send Order';
        actions.appendChild(submit);
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn-secondary';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', function () {
            container.innerHTML = '';
            container.hidden = true;
        });
        actions.appendChild(cancel);
        form.appendChild(actions);

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            if (!form.checkValidity()) { form.reportValidity(); return; }
            sendOrder({
                name: nameInput.value.trim(),
                phone: phoneInput.value.trim(),
                email: emailInput.value.trim(),
                items: chosen
            });
        });

        container.appendChild(form);
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function addField(parent, labelText, id, type, autocomplete) {
        var wrap = document.createElement('label');
        wrap.className = 'order-field';
        wrap.htmlFor = id;
        var lab = document.createElement('span');
        lab.className = 'order-field-label';
        lab.textContent = labelText;
        var input = document.createElement('input');
        input.id = id;
        input.name = id;
        input.type = type;
        input.required = true;
        input.autocomplete = autocomplete;
        wrap.appendChild(lab);
        wrap.appendChild(input);
        parent.appendChild(wrap);
        return input;
    }

    function sendOrder(order) {
        var lines = [];
        lines.push('Order from: ' + order.name);
        lines.push('Phone: ' + order.phone);
        lines.push('Email: ' + order.email);
        lines.push('');
        lines.push('Items:');
        order.items.forEach(function (item) {
            lines.push(
                '- ' + item.type + ' \u2014 ' + item.name +
                ' \u00d7 ' + item.selected + ' (' + item.price + ')'
            );
        });
        lines.push('');
        lines.push('Please confirm availability and total.');

        var subject = 'Elysian Meats Order from ' + order.name;
        var body = lines.join('\r\n');
        var href = 'mailto:' + contactEmail() +
            '?subject=' + encodeURIComponent(subject) +
            '&body=' + encodeURIComponent(body);
        window.location.href = href;
    }

    // --- Boot ---------------------------------------------------------------
    function init() {
        renderEmailLink();
        loadPrices();
        wireOrderButton();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
