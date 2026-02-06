// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec',
    SHEET_URL: 'https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit',
    CSV_FILE: 'cascading_data.csv',
    ADMIN_USER: 'admin',
    ADMIN_PASS: 'admin123'
};

// ============================================
// STATE
// ============================================
const state = {
    currentSection: 1,
    totalSections: 5,
    isOnline: navigator.onLine,
    pendingSubmissions: [],
    drafts: [],
    signaturePads: {},
    formStatus: 'draft',
    currentDraftId: null,
    charts: {}
};

let LOCATION_DATA = {};

// ============================================
// INITIALIZATION
// ============================================
async function init() {
    loadFromStorage();
    updateOnlineStatus();
    updateCounts();
    setupEventListeners();
    
    try {
        await loadLocationData();
    } catch (e) {
        console.warn('Could not load location data:', e);
    }
    
    populateDistricts();
    setupCascading();
    setupValidation();
    setupPhoneValidation();
    setupCalculations();
    initAllSignaturePads();
    captureGPS();
    setDefaultDate();
    updateProgress();
}

function loadFromStorage() {
    try {
        state.pendingSubmissions = JSON.parse(localStorage.getItem('itn_pending') || '[]');
        state.drafts = JSON.parse(localStorage.getItem('itn_drafts') || '[]');
    } catch (e) {
        state.pendingSubmissions = [];
        state.drafts = [];
    }
}

function saveToStorage() {
    localStorage.setItem('itn_pending', JSON.stringify(state.pendingSubmissions));
    localStorage.setItem('itn_drafts', JSON.stringify(state.drafts));
}

function setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    const surveyDate = document.getElementById('survey_date');
    const distDate = document.getElementById('distribution_date');
    if (surveyDate && !surveyDate.value) surveyDate.value = today;
    if (distDate && !distDate.value) distDate.value = today;
}

// ============================================
// LOCATION DATA (CSV)
// ============================================
function loadLocationData() {
    return new Promise((resolve, reject) => {
        Papa.parse(CONFIG.CSV_FILE, {
            download: true,
            header: true,
            skipEmptyLines: true,
            complete: function(results) {
                LOCATION_DATA = {};
                results.data.forEach(row => {
                    const district = (row.adm1 || '').trim();
                    const chiefdom = (row.adm2 || '').trim();
                    const section = (row.adm3 || '').trim();
                    const facility = (row.hf || '').trim();
                    const community = (row.community || '').trim();
                    const school = (row.school_name || '').trim();
                    
                    if (!district) return;
                    
                    // Build nested structure: district -> chiefdom -> section -> facility -> community -> schools[]
                    if (!LOCATION_DATA[district]) LOCATION_DATA[district] = {};
                    if (!LOCATION_DATA[district][chiefdom]) LOCATION_DATA[district][chiefdom] = {};
                    if (!LOCATION_DATA[district][chiefdom][section]) LOCATION_DATA[district][chiefdom][section] = {};
                    if (!LOCATION_DATA[district][chiefdom][section][facility]) LOCATION_DATA[district][chiefdom][section][facility] = {};
                    if (community && !LOCATION_DATA[district][chiefdom][section][facility][community]) {
                        LOCATION_DATA[district][chiefdom][section][facility][community] = [];
                    }
                    if (community && school && !LOCATION_DATA[district][chiefdom][section][facility][community].includes(school)) {
                        LOCATION_DATA[district][chiefdom][section][facility][community].push(school);
                    }
                });
                
                // Sort schools within each community
                for (const d in LOCATION_DATA) {
                    for (const c in LOCATION_DATA[d]) {
                        for (const s in LOCATION_DATA[d][c]) {
                            for (const f in LOCATION_DATA[d][c][s]) {
                                for (const com in LOCATION_DATA[d][c][s][f]) {
                                    LOCATION_DATA[d][c][s][f][com].sort();
                                }
                            }
                        }
                    }
                }
                resolve();
            },
            error: reject
        });
    });
}

function populateDistricts() {
    const select = document.getElementById('district');
    if (!select) return;
    select.innerHTML = '<option value="">Select District...</option>';
    Object.keys(LOCATION_DATA).sort().forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        select.appendChild(opt);
    });
    updateCount('district', Object.keys(LOCATION_DATA).length);
}

function setupCascading() {
    const district = document.getElementById('district');
    const chiefdom = document.getElementById('chiefdom');
    const section = document.getElementById('section_loc');
    const facility = document.getElementById('facility');
    const community = document.getElementById('community');
    const school = document.getElementById('school_name');

    if (!district) return;

    // District change
    district.addEventListener('change', function() {
        resetSelect(chiefdom, 'Select Chiefdom...');
        resetSelect(section, 'Select Section...');
        resetSelect(facility, 'Select Health Facility...');
        resetSelect(community, 'Select Community...');
        resetSelect(school, 'Select School...');
        clearCount('chiefdom'); clearCount('section_loc'); clearCount('facility');
        clearCount('community'); clearCount('school_name');
        
        const d = this.value;
        if (d && LOCATION_DATA[d]) {
            chiefdom.disabled = false;
            const chiefdoms = Object.keys(LOCATION_DATA[d]).sort();
            chiefdoms.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c; opt.textContent = c;
                chiefdom.appendChild(opt);
            });
            updateCount('chiefdom', chiefdoms.length);
        }
    });

    // Chiefdom change
    chiefdom.addEventListener('change', function() {
        resetSelect(section, 'Select Section...');
        resetSelect(facility, 'Select Health Facility...');
        resetSelect(community, 'Select Community...');
        resetSelect(school, 'Select School...');
        clearCount('section_loc'); clearCount('facility');
        clearCount('community'); clearCount('school_name');
        
        const d = district.value, c = this.value;
        if (d && c && LOCATION_DATA[d] && LOCATION_DATA[d][c]) {
            section.disabled = false;
            const sections = Object.keys(LOCATION_DATA[d][c]).sort();
            sections.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s; opt.textContent = s;
                section.appendChild(opt);
            });
            updateCount('section_loc', sections.length);
        }
    });

    // Section change
    section.addEventListener('change', function() {
        resetSelect(facility, 'Select Health Facility...');
        resetSelect(community, 'Select Community...');
        resetSelect(school, 'Select School...');
        clearCount('facility'); clearCount('community'); clearCount('school_name');
        
        const d = district.value, c = chiefdom.value, s = this.value;
        if (d && c && s && LOCATION_DATA[d] && LOCATION_DATA[d][c] && LOCATION_DATA[d][c][s]) {
            facility.disabled = false;
            const facilities = Object.keys(LOCATION_DATA[d][c][s]).sort();
            facilities.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f; opt.textContent = f;
                facility.appendChild(opt);
            });
            updateCount('facility', facilities.length);
        }
    });

    // Facility change
    facility.addEventListener('change', function() {
        resetSelect(community, 'Select Community...');
        resetSelect(school, 'Select School...');
        clearCount('community'); clearCount('school_name');
        
        const d = district.value, c = chiefdom.value, s = section.value, f = this.value;
        if (d && c && s && f && LOCATION_DATA[d] && LOCATION_DATA[d][c] && LOCATION_DATA[d][c][s] && LOCATION_DATA[d][c][s][f]) {
            community.disabled = false;
            const communities = Object.keys(LOCATION_DATA[d][c][s][f]).sort();
            communities.forEach(com => {
                const opt = document.createElement('option');
                opt.value = com; opt.textContent = com;
                community.appendChild(opt);
            });
            updateCount('community', communities.length);
        }
    });

    // Community change
    community.addEventListener('change', function() {
        resetSelect(school, 'Select School...');
        clearCount('school_name');
        
        const d = district.value, c = chiefdom.value, s = section.value, f = facility.value, com = this.value;
        if (d && c && s && f && com && LOCATION_DATA[d] && LOCATION_DATA[d][c] && LOCATION_DATA[d][c][s] && LOCATION_DATA[d][c][s][f] && LOCATION_DATA[d][c][s][f][com]) {
            school.disabled = false;
            const schools = LOCATION_DATA[d][c][s][f][com];
            schools.forEach(sch => {
                const opt = document.createElement('option');
                opt.value = sch; opt.textContent = sch;
                school.appendChild(opt);
            });
            updateCount('school_name', schools.length);
        }
    });
}

function resetSelect(el, placeholder) {
    el.innerHTML = `<option value="">${placeholder}</option>`;
    el.disabled = true;
}

function updateCount(id, count) {
    const el = document.getElementById('count_' + id);
    if (el) el.textContent = `${count} options`;
}

function clearCount(id) {
    const el = document.getElementById('count_' + id);
    if (el) el.textContent = '';
}

// ============================================
// VALIDATION
// ============================================
function setupValidation() {
    document.querySelectorAll('.itn-field').forEach(input => {
        input.addEventListener('input', function() {
            validateITNField(this);
            calculateAll();
        });
    });

    document.querySelectorAll('.enrollment-field').forEach(input => {
        input.addEventListener('input', function() {
            const classNum = this.dataset.class;
            const gender = this.dataset.gender;
            const itnField = document.getElementById(`c${classNum}_${gender}_itn`);
            if (itnField) validateITNField(itnField);
            calculateAll();
        });
    });
}

function validateITNField(itnInput) {
    const maxFieldId = itnInput.dataset.maxField;
    const maxField = document.getElementById(maxFieldId);
    if (!maxField) return true;

    const maxVal = parseInt(maxField.value) || 0;
    const itnVal = parseInt(itnInput.value) || 0;
    const errorEl = document.getElementById('error_' + itnInput.id);

    if (itnVal > maxVal) {
        itnInput.classList.add('error');
        if (errorEl) errorEl.classList.add('show');
        return false;
    } else {
        itnInput.classList.remove('error');
        if (errorEl) errorEl.classList.remove('show');
        return true;
    }
}

function validateAllITNFields() {
    let valid = true;
    document.querySelectorAll('.itn-field').forEach(input => {
        if (!validateITNField(input)) valid = false;
    });
    return valid;
}

// ============================================
// ITN TYPE QUANTITY VALIDATION
// ============================================
function toggleITNTypeQuantity() {
    const pboChecked = document.getElementById('itn_type_pbo').checked;
    const ig2Checked = document.getElementById('itn_type_ig2').checked;
    const quantityFields = document.getElementById('itn_quantity_fields');
    const pboGroup = document.getElementById('pbo_quantity_group');
    const ig2Group = document.getElementById('ig2_quantity_group');
    
    // Show/hide quantity fields container
    if (pboChecked || ig2Checked) {
        quantityFields.style.display = 'block';
    } else {
        quantityFields.style.display = 'none';
    }
    
    // Show/hide individual quantity fields
    if (pboChecked) {
        pboGroup.style.display = 'block';
    } else {
        pboGroup.style.display = 'none';
        document.getElementById('itn_qty_pbo').value = 0;
    }
    
    if (ig2Checked) {
        ig2Group.style.display = 'block';
    } else {
        ig2Group.style.display = 'none';
        document.getElementById('itn_qty_ig2').value = 0;
    }
    
    validateITNQuantities();
}

function validateITNQuantities() {
    const totalReceived = parseInt(document.getElementById('itns_received').value) || 0;
    const pboChecked = document.getElementById('itn_type_pbo').checked;
    const ig2Checked = document.getElementById('itn_type_ig2').checked;
    const pboQty = parseInt(document.getElementById('itn_qty_pbo').value) || 0;
    const ig2Qty = parseInt(document.getElementById('itn_qty_ig2').value) || 0;
    
    const totalFromTypes = pboQty + ig2Qty;
    
    // Update display
    document.getElementById('itn_type_total').textContent = totalFromTypes;
    
    const statusEl = document.getElementById('itn_qty_status');
    const errorEl = document.getElementById('error_itn_qty_mismatch');
    
    if (!pboChecked && !ig2Checked) {
        statusEl.textContent = '';
        statusEl.className = 'qty-status';
        errorEl.style.display = 'none';
        return true;
    }
    
    if (totalFromTypes === totalReceived) {
        statusEl.textContent = 'MATCHES';
        statusEl.className = 'qty-status match';
        errorEl.style.display = 'none';
        return true;
    } else {
        statusEl.textContent = 'MISMATCH (Expected: ' + totalReceived + ')';
        statusEl.className = 'qty-status mismatch';
        errorEl.style.display = 'block';
        return false;
    }
}

function validateITNTypeSelection() {
    const pboChecked = document.getElementById('itn_type_pbo').checked;
    const ig2Checked = document.getElementById('itn_type_ig2').checked;
    const errorEl = document.getElementById('error_itn_type');
    
    if (!pboChecked && !ig2Checked) {
        errorEl.classList.add('show');
        return false;
    }
    errorEl.classList.remove('show');
    return true;
}

// ============================================
// PHONE VALIDATION (9 digits only)
// ============================================
function setupPhoneValidation() {
    document.querySelectorAll('.phone-field').forEach(input => {
        input.addEventListener('input', function() {
            // Remove non-digits
            this.value = this.value.replace(/\D/g, '');
            // Limit to 9 digits
            if (this.value.length > 9) {
                this.value = this.value.slice(0, 9);
            }
            validatePhoneField(this);
        });
    });
}

function validatePhoneField(input) {
    const errorEl = document.getElementById('error_' + input.id);
    const isRequired = input.hasAttribute('required');
    const value = input.value.trim();
    
    if (value === '' && !isRequired) {
        input.classList.remove('error');
        if (errorEl) errorEl.classList.remove('show');
        return true;
    }
    
    if (value.length !== 9 || !/^\d{9}$/.test(value)) {
        input.classList.add('error');
        if (errorEl) errorEl.classList.add('show');
        return false;
    }
    
    input.classList.remove('error');
    if (errorEl) errorEl.classList.remove('show');
    return true;
}

function validateAllPhoneFields() {
    let valid = true;
    document.querySelectorAll('.phone-field[required]').forEach(input => {
        if (!validatePhoneField(input)) valid = false;
    });
    return valid;
}

// ============================================
// CALCULATIONS
// ============================================
function setupCalculations() {
    document.querySelectorAll('.enrollment-field, .itn-field').forEach(input => {
        input.addEventListener('input', calculateAll);
    });
    
    // Add listener for ITNs received to update remaining calculation
    const itnsReceivedField = document.getElementById('itns_received');
    if (itnsReceivedField) {
        itnsReceivedField.addEventListener('input', function() {
            calculateAll();
            validateITNQuantities();
        });
    }
}

function calculateAll() {
    let totalBoys = 0, totalGirls = 0, totalBoysITN = 0, totalGirlsITN = 0;

    for (let c = 1; c <= 5; c++) {
        const boys = getNum(`c${c}_boys`);
        const boysITN = getNum(`c${c}_boys_itn`);
        const girls = getNum(`c${c}_girls`);
        const girlsITN = getNum(`c${c}_girls_itn`);

        totalBoys += boys;
        totalGirls += girls;
        totalBoysITN += boysITN;
        totalGirlsITN += girlsITN;

        setText(`t${c}_b`, boys);
        setText(`t${c}_bi`, boysITN);
        setText(`t${c}_g`, girls);
        setText(`t${c}_gi`, girlsITN);
        setText(`t${c}_t`, boys + girls);
        setText(`t${c}_ti`, boysITN + girlsITN);
        const classTotal = boys + girls;
        const classITN = boysITN + girlsITN;
        setText(`t${c}_c`, classTotal > 0 ? Math.round((classITN / classTotal) * 100) + '%' : '0%');
    }

    const totalPupils = totalBoys + totalGirls;
    const totalITN = totalBoysITN + totalGirlsITN;

    setText('sum_total_boys', totalBoys);
    setText('sum_total_girls', totalGirls);
    setText('sum_total_pupils', totalPupils);
    setText('sum_boys_itn', totalBoysITN);
    setText('sum_girls_itn', totalGirlsITN);
    setText('sum_total_itn', totalITN);

    setVal('total_boys', totalBoys);
    setVal('total_girls', totalGirls);
    setVal('total_pupils', totalPupils);
    setVal('total_boys_itn', totalBoysITN);
    setVal('total_girls_itn', totalGirlsITN);
    setVal('total_itn', totalITN);

    // Calculate ITNs remaining (received - distributed)
    const itnsReceived = getNum('itns_received');
    const itnsRemaining = itnsReceived - totalITN;
    setText('itns_remaining', itnsRemaining);
    setVal('itns_remaining_val', itnsRemaining);
    
    // Update remaining status
    const remainingStatus = document.getElementById('remaining_status');
    if (remainingStatus) {
        if (itnsRemaining < 0) {
            remainingStatus.textContent = 'Warning: More ITNs distributed than received!';
            remainingStatus.className = 'remaining-status warning';
        } else if (itnsRemaining === 0 && itnsReceived > 0) {
            remainingStatus.textContent = 'All ITNs distributed';
            remainingStatus.className = 'remaining-status success';
        } else {
            remainingStatus.textContent = '';
            remainingStatus.className = 'remaining-status';
        }
    }

    const propBoys = totalPupils > 0 ? Math.round((totalBoys / totalPupils) * 100) : 0;
    const propGirls = totalPupils > 0 ? Math.round((totalGirls / totalPupils) * 100) : 0;
    setText('prop_boys', propBoys + '%');
    setText('prop_girls', propGirls + '%');
    setVal('prop_boys_val', propBoys);
    setVal('prop_girls_val', propGirls);

    const barBoys = document.getElementById('bar_boys');
    const barGirls = document.getElementById('bar_girls');
    if (barBoys) barBoys.style.width = propBoys + '%';
    if (barGirls) barGirls.style.width = propGirls + '%';

    const covBoys = totalBoys > 0 ? Math.round((totalBoysITN / totalBoys) * 100) : 0;
    const covGirls = totalGirls > 0 ? Math.round((totalGirlsITN / totalGirls) * 100) : 0;
    const covTotal = totalPupils > 0 ? Math.round((totalITN / totalPupils) * 100) : 0;
    setText('cov_boys', covBoys + '%');
    setText('cov_girls', covGirls + '%');
    setText('cov_total', covTotal + '%');
    setVal('coverage_boys', covBoys);
    setVal('coverage_girls', covGirls);
    setVal('coverage_total', covTotal);

    setText('tt_b', totalBoys);
    setText('tt_bi', totalBoysITN);
    setText('tt_g', totalGirls);
    setText('tt_gi', totalGirlsITN);
    setText('tt_t', totalPupils);
    setText('tt_ti', totalITN);
    setText('tt_c', totalPupils > 0 ? Math.round((totalITN / totalPupils) * 100) + '%' : '0%');

    updateCharts();
}

// ============================================
// ITN TYPE HANDLING
// ============================================
function toggleITNTypeQuantity() {
    const pboChecked = document.getElementById('itn_type_pbo').checked;
    const ig2Checked = document.getElementById('itn_type_ig2').checked;
    
    const quantityFields = document.getElementById('itn_quantity_fields');
    const pboGroup = document.getElementById('pbo_quantity_group');
    const ig2Group = document.getElementById('ig2_quantity_group');
    
    // Show/hide quantity section
    if (pboChecked || ig2Checked) {
        quantityFields.style.display = 'block';
    } else {
        quantityFields.style.display = 'none';
    }
    
    // Show/hide individual quantity fields
    pboGroup.style.display = pboChecked ? 'block' : 'none';
    ig2Group.style.display = ig2Checked ? 'block' : 'none';
    
    // Reset hidden quantities to 0
    if (!pboChecked) document.getElementById('itn_qty_pbo').value = 0;
    if (!ig2Checked) document.getElementById('itn_qty_ig2').value = 0;
    
    validateITNQuantities();
}

function validateITNQuantities() {
    const itnsReceived = getNum('itns_received');
    const pboQty = getNum('itn_qty_pbo');
    const ig2Qty = getNum('itn_qty_ig2');
    const totalFromTypes = pboQty + ig2Qty;
    
    // Update total display
    const totalDisplay = document.getElementById('itn_type_total');
    const statusDisplay = document.getElementById('itn_qty_status');
    const mismatchError = document.getElementById('error_itn_qty_mismatch');
    
    if (totalDisplay) totalDisplay.textContent = totalFromTypes;
    
    const pboChecked = document.getElementById('itn_type_pbo').checked;
    const ig2Checked = document.getElementById('itn_type_ig2').checked;
    
    if ((pboChecked || ig2Checked) && itnsReceived > 0) {
        if (totalFromTypes === itnsReceived) {
            statusDisplay.textContent = '✓ Matches total received';
            statusDisplay.className = 'qty-status match';
            mismatchError.style.display = 'none';
            return true;
        } else {
            statusDisplay.textContent = '✗ Does not match (' + itnsReceived + ' received)';
            statusDisplay.className = 'qty-status mismatch';
            mismatchError.style.display = 'block';
            return false;
        }
    } else {
        statusDisplay.textContent = '';
        statusDisplay.className = 'qty-status';
        mismatchError.style.display = 'none';
        return true;
    }
}

function getNum(id) {
    const el = document.getElementById(id);
    return el ? (parseInt(el.value) || 0) : 0;
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

// ============================================
// CHARTS
// ============================================
function updateCharts() {
    const totalBoys = getNum('total_boys');
    const totalGirls = getNum('total_girls');
    const boysITN = getNum('total_boys_itn');
    const girlsITN = getNum('total_girls_itn');

    const ctx1 = document.getElementById('chartEnrollment');
    if (ctx1) {
        if (state.charts.enrollment) state.charts.enrollment.destroy();
        state.charts.enrollment = new Chart(ctx1, {
            type: 'doughnut',
            data: {
                labels: ['Boys', 'Girls'],
                datasets: [{
                    data: [totalBoys, totalGirls],
                    backgroundColor: ['#004080', '#e91e8c'],
                    borderWidth: 2, borderColor: '#fff'
                }]
            },
            options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
        });
    }

    const ctx2 = document.getElementById('chartITN');
    if (ctx2) {
        if (state.charts.itn) state.charts.itn.destroy();
        state.charts.itn = new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: ['Boys', 'Girls'],
                datasets: [{
                    data: [boysITN, girlsITN],
                    backgroundColor: ['#004080', '#e91e8c'],
                    borderWidth: 2, borderColor: '#fff'
                }]
            },
            options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
        });
    }

    const ctx3 = document.getElementById('chartCoverage');
    if (ctx3) {
        const coverages = [];
        for (let c = 1; c <= 5; c++) {
            const total = getNum(`c${c}_boys`) + getNum(`c${c}_girls`);
            const itn = getNum(`c${c}_boys_itn`) + getNum(`c${c}_girls_itn`);
            coverages.push(total > 0 ? Math.round((itn / total) * 100) : 0);
        }
        if (state.charts.coverage) state.charts.coverage.destroy();
        state.charts.coverage = new Chart(ctx3, {
            type: 'bar',
            data: {
                labels: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'],
                datasets: [{
                    label: 'Coverage %',
                    data: coverages,
                    backgroundColor: '#28a745',
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: true,
                scales: { y: { beginAtZero: true, max: 100 } },
                plugins: { legend: { display: false } }
            }
        });
    }
}

// ============================================
// GPS
// ============================================
function captureGPS() {
    const icon = document.getElementById('gps_icon');
    const status = document.getElementById('gps_status');
    const coords = document.getElementById('gps_coords');

    if (!navigator.geolocation) {
        if (icon) icon.classList.add('error');
        if (status) status.textContent = 'GPS not supported';
        return;
    }

    if (icon) icon.classList.add('loading');
    if (status) status.textContent = 'Capturing GPS...';

    navigator.geolocation.getCurrentPosition(
        pos => {
            const { latitude, longitude, accuracy } = pos.coords;
            setVal('gps_lat', latitude.toFixed(6));
            setVal('gps_lng', longitude.toFixed(6));
            setVal('gps_acc', Math.round(accuracy));
            if (icon) { icon.classList.remove('loading'); icon.classList.add('success'); }
            if (status) status.textContent = 'GPS captured!';
            if (coords) coords.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)} (${Math.round(accuracy)}m)`;
        },
        err => {
            if (icon) { icon.classList.remove('loading'); icon.classList.add('error'); }
            if (status) status.textContent = 'GPS failed (optional)';
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
    );
}

// ============================================
// SIGNATURE PADS (Multiple for team members)
// ============================================
function initAllSignaturePads() {
    // Initialize signature pads for all 3 team members
    for (let i = 1; i <= 3; i++) {
        initTeamSignaturePad(i);
    }
}

function initTeamSignaturePad(teamNum) {
    const canvas = document.getElementById(`sig${teamNum}Canvas`);
    if (!canvas) return;
    
    const container = canvas.parentElement;
    canvas.width = container.offsetWidth - 10;
    canvas.height = 100;
    
    state.signaturePads[teamNum] = new SignaturePad(canvas, {
        backgroundColor: '#fff',
        penColor: '#000'
    });

    state.signaturePads[teamNum].addEventListener('endStroke', () => {
        const hiddenInput = document.getElementById(`team${teamNum}_signature`);
        if (hiddenInput) {
            hiddenInput.value = state.signaturePads[teamNum].toDataURL();
        }
    });
}

function clearTeamSignature(teamNum) {
    if (state.signaturePads[teamNum]) {
        state.signaturePads[teamNum].clear();
        const hiddenInput = document.getElementById(`team${teamNum}_signature`);
        if (hiddenInput) hiddenInput.value = '';
    }
}

function clearSignature() {
    // Clear all signatures
    for (let i = 1; i <= 3; i++) {
        clearTeamSignature(i);
    }
}

// ============================================
// NAVIGATION
// ============================================
function nextSection() {
    if (!validateCurrentSection()) return;
    
    if (state.currentSection < state.totalSections) {
        document.querySelector(`.form-section[data-section="${state.currentSection}"]`).classList.remove('active');
        state.currentSection++;
        document.querySelector(`.form-section[data-section="${state.currentSection}"]`).classList.add('active');
        updateProgress();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        if (state.currentSection === 4) {
            calculateAll();
        }
    }
}

function previousSection() {
    if (state.currentSection > 1) {
        document.querySelector(`.form-section[data-section="${state.currentSection}"]`).classList.remove('active');
        state.currentSection--;
        document.querySelector(`.form-section[data-section="${state.currentSection}"]`).classList.add('active');
        updateProgress();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function validateCurrentSection() {
    const section = document.querySelector(`.form-section[data-section="${state.currentSection}"]`);
    if (!section) return true;
    if (state.currentSection === 1) return true;

    let valid = true;
    let firstInvalid = null;

    section.querySelectorAll('input[required], select[required]').forEach(input => {
        if (input.type === 'hidden') return;
        if (!input.value || input.value.trim() === '') {
            valid = false;
            input.classList.add('error');
            const err = document.getElementById('error_' + input.id);
            if (err) err.classList.add('show');
            if (!firstInvalid) firstInvalid = input;
        } else {
            input.classList.remove('error');
            const err = document.getElementById('error_' + input.id);
            if (err) err.classList.remove('show');
        }
    });

    // Validate ITN fields in section 3
    if (state.currentSection === 3) {
        // Validate ITN type selection
        if (!validateITNTypeSelection()) {
            valid = false;
            showNotification('Please select at least one ITN type.', 'error');
        }
        
        // Validate ITN type quantities match total received
        if (!validateITNQuantities()) {
            valid = false;
            showNotification('ITN type quantities must equal total ITNs received.', 'error');
        }
        
        if (!validateAllITNFields()) {
            valid = false;
            showNotification('ITNs distributed cannot exceed enrollment. Please correct the errors.', 'error');
        }
        
        // Validate teacher phone numbers
        section.querySelectorAll('.phone-field[required]').forEach(input => {
            if (!validatePhoneField(input)) {
                valid = false;
                if (!firstInvalid) firstInvalid = input;
            }
        });
    }

    // Validate phone fields in section 5
    if (state.currentSection === 5) {
        section.querySelectorAll('.phone-field[required]').forEach(input => {
            if (!validatePhoneField(input)) {
                valid = false;
                if (!firstInvalid) firstInvalid = input;
            }
        });
    }

    if (!valid) {
        showNotification('Please fill in all required fields correctly.', 'error');
        if (firstInvalid) firstInvalid.focus();
    }

    return valid;
}

function updateProgress() {
    const pct = (state.currentSection / state.totalSections) * 100;
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressText').textContent = `SECTION ${state.currentSection} OF ${state.totalSections}`;
}

// ============================================
// DRAFTS
// ============================================
function showDraftNameModal() {
    const modal = document.getElementById('draftNameModal');
    const input = document.getElementById('draftNameInput');
    
    // Auto-generate draft name from cascading fields
    const draftName = generateDraftName();
    input.value = draftName;
    input.readOnly = true; // Make readonly - auto-generated
    
    modal.classList.add('show');
}

function generateDraftName() {
    const district = document.getElementById('district');
    const chiefdom = document.getElementById('chiefdom');
    const section = document.getElementById('section_loc');
    const community = document.getElementById('community');
    const school = document.getElementById('school_name');
    
    const parts = [];
    
    if (district && district.value) {
        // Get short district name (remove "District" suffix)
        let distName = district.value.replace(' District', '').trim();
        parts.push(distName);
    }
    if (chiefdom && chiefdom.value) {
        parts.push(chiefdom.value);
    }
    if (section && section.value) {
        parts.push(section.value);
    }
    if (community && community.value) {
        parts.push(community.value);
    }
    if (school && school.value) {
        parts.push(school.value);
    }
    
    if (parts.length === 0) {
        return 'Draft - ' + new Date().toLocaleDateString();
    }
    
    return parts.join('-');
}

function cancelDraftName() {
    document.getElementById('draftNameModal').classList.remove('show');
}

function confirmSaveDraft() {
    const name = document.getElementById('draftNameInput').value.trim() || 'Unnamed Draft';
    cancelDraftName();
    saveDraft(name);
}

function saveDraft(name) {
    const formData = new FormData(document.getElementById('dataForm'));
    const data = { draftId: state.currentDraftId || 'draft_' + Date.now(), draftName: name, savedAt: new Date().toISOString(), currentSection: state.currentSection };
    for (const [k, v] of formData.entries()) data[k] = v;
    
    // Explicitly save checkbox states (FormData doesn't include unchecked checkboxes)
    data.itn_type_pbo = document.getElementById('itn_type_pbo').checked;
    data.itn_type_ig2 = document.getElementById('itn_type_ig2').checked;

    const idx = state.drafts.findIndex(d => d.draftId === data.draftId);
    if (idx >= 0) state.drafts[idx] = data;
    else state.drafts.push(data);

    state.currentDraftId = data.draftId;
    saveToStorage();
    updateCounts();
    showNotification('Draft "' + name + '" saved!', 'success');
}

function openDraftsModal() {
    const modal = document.getElementById('draftsModal');
    const body = document.getElementById('draftsModalBody');

    if (state.drafts.length === 0) {
        body.innerHTML = '<div class="no-drafts">No saved drafts</div>';
    } else {
        body.innerHTML = state.drafts.map(d => `
            <div class="draft-item">
                <div class="draft-info">
                    <div class="draft-name">${d.draftName}</div>
                    <div class="draft-date">${new Date(d.savedAt).toLocaleString()}</div>
                </div>
                <div class="draft-actions">
                    <button class="draft-btn load" onclick="loadDraft('${d.draftId}')">Load</button>
                    <button class="draft-btn delete" onclick="deleteDraft('${d.draftId}')">Delete</button>
                </div>
            </div>
        `).join('');
    }
    modal.classList.add('show');
}

function closeDraftsModal() {
    document.getElementById('draftsModal').classList.remove('show');
}

function loadDraft(id) {
    const draft = state.drafts.find(d => d.draftId === id);
    if (!draft) return;

    state.currentDraftId = id;
    
    // Load cascading fields in sequence with delays
    if (draft.district) {
        document.getElementById('district').value = draft.district;
        document.getElementById('district').dispatchEvent(new Event('change'));
    }
    
    setTimeout(() => {
        if (draft.chiefdom) {
            document.getElementById('chiefdom').value = draft.chiefdom;
            document.getElementById('chiefdom').dispatchEvent(new Event('change'));
        }
        setTimeout(() => {
            if (draft.section_loc) {
                document.getElementById('section_loc').value = draft.section_loc;
                document.getElementById('section_loc').dispatchEvent(new Event('change'));
            }
            setTimeout(() => {
                if (draft.facility) {
                    document.getElementById('facility').value = draft.facility;
                    document.getElementById('facility').dispatchEvent(new Event('change'));
                }
                setTimeout(() => {
                    if (draft.community) {
                        document.getElementById('community').value = draft.community;
                        document.getElementById('community').dispatchEvent(new Event('change'));
                    }
                    setTimeout(() => {
                        if (draft.school_name) {
                            document.getElementById('school_name').value = draft.school_name;
                        }
                        
                        // Load all other fields
                        Object.keys(draft).forEach(k => {
                            if (['draftId', 'draftName', 'savedAt', 'currentSection', 'district', 'chiefdom', 'section_loc', 'facility', 'community', 'school_name', 'itn_type_pbo', 'itn_type_ig2'].includes(k)) return;
                            const el = document.getElementById(k);
                            if (el) el.value = draft[k];
                        });
                        
                        // Restore ITN type checkboxes
                        if (draft.itn_type_pbo !== undefined) {
                            document.getElementById('itn_type_pbo').checked = draft.itn_type_pbo;
                        }
                        if (draft.itn_type_ig2 !== undefined) {
                            document.getElementById('itn_type_ig2').checked = draft.itn_type_ig2;
                        }
                        // Trigger toggle to show/hide quantity fields
                        toggleITNTypeQuantity();

                        if (draft.currentSection) {
                            document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
                            state.currentSection = draft.currentSection;
                            document.querySelector(`.form-section[data-section="${draft.currentSection}"]`).classList.add('active');
                        }
                        updateProgress();
                        calculateAll();
                    }, 100);
                }, 100);
            }, 100);
        }, 100);
    }, 100);

    closeDraftsModal();
    showNotification('Draft "' + draft.draftName + '" loaded!', 'success');
}

function deleteDraft(id) {
    if (!confirm('Delete this draft?')) return;
    state.drafts = state.drafts.filter(d => d.draftId !== id);
    saveToStorage();
    updateCounts();
    openDraftsModal();
}

// ============================================
// FINALIZE & SUBMIT
// ============================================
function finalizeForm() {
    for (let s = 2; s <= state.totalSections; s++) {
        state.currentSection = s;
        if (!validateCurrentSection()) {
            document.querySelectorAll('.form-section').forEach(sec => sec.classList.remove('active'));
            document.querySelector(`.form-section[data-section="${s}"]`).classList.add('active');
            updateProgress();
            return;
        }
    }

    // Validate all phone fields
    if (!validateAllPhoneFields()) {
        showNotification('Please enter valid 9-digit phone numbers.', 'error');
        return;
    }

    // Validate ITN type selection
    const pboChecked = document.getElementById('itn_type_pbo').checked;
    const ig2Checked = document.getElementById('itn_type_ig2').checked;
    if (!pboChecked && !ig2Checked) {
        showNotification('Please select at least one ITN type (PBO or IG2).', 'error');
        state.currentSection = 3;
        document.querySelectorAll('.form-section').forEach(sec => sec.classList.remove('active'));
        document.querySelector('.form-section[data-section="3"]').classList.add('active');
        updateProgress();
        return;
    }

    // Validate ITN quantities match total received
    if (!validateITNQuantities()) {
        showNotification('ITN type quantities must equal total ITNs received.', 'error');
        state.currentSection = 3;
        document.querySelectorAll('.form-section').forEach(sec => sec.classList.remove('active'));
        document.querySelector('.form-section[data-section="3"]').classList.add('active');
        updateProgress();
        return;
    }

    // Check team member 1 signature (required)
    if (!document.getElementById('team1_signature').value) {
        showNotification('Please provide Team Member 1 signature.', 'error');
        return;
    }

    state.formStatus = 'finalized';
    document.getElementById('form_status').value = 'finalized';
    document.getElementById('submitBtn').disabled = false;
    document.getElementById('finalizeBtn').disabled = true;
    showNotification('Form finalized! You can now submit.', 'success');
}

async function handleSubmit(e) {
    e.preventDefault();
    if (state.formStatus !== 'finalized') {
        showNotification('Please finalize the form first.', 'error');
        return;
    }

    const formData = new FormData(e.target);
    const data = { timestamp: new Date().toISOString() };
    for (const [k, v] of formData.entries()) data[k] = v;

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<svg class="nav-icon spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> SUBMITTING...';

    if (state.isOnline) {
        try {
            await fetch(CONFIG.SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            if (state.currentDraftId) {
                state.drafts = state.drafts.filter(d => d.draftId !== state.currentDraftId);
                saveToStorage();
                updateCounts();
            }
            
            showNotification('Submitted successfully!', 'success');
            resetForm();
        } catch (err) {
            saveOffline(data);
        }
    } else {
        saveOffline(data);
    }

    submitBtn.disabled = false;
    submitBtn.innerHTML = '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> SUBMIT';
}

function saveOffline(data) {
    state.pendingSubmissions.push(data);
    saveToStorage();
    updateCounts();
    showNotification('Saved offline. Will sync when online.', 'info');
    resetForm();
}

function resetForm() {
    document.getElementById('dataForm').reset();
    clearSignature();
    state.currentSection = 1;
    state.currentDraftId = null;
    state.formStatus = 'draft';
    document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
    document.querySelector('.form-section[data-section="1"]').classList.add('active');
    document.getElementById('submitBtn').disabled = true;
    document.getElementById('finalizeBtn').disabled = false;
    
    // Reset all 6 cascading dropdowns
    const chiefdom = document.getElementById('chiefdom');
    const section = document.getElementById('section_loc');
    const facility = document.getElementById('facility');
    const community = document.getElementById('community');
    const school = document.getElementById('school_name');
    
    if (chiefdom) { chiefdom.innerHTML = '<option value="">Select Chiefdom...</option>'; chiefdom.disabled = true; }
    if (section) { section.innerHTML = '<option value="">Select Section...</option>'; section.disabled = true; }
    if (facility) { facility.innerHTML = '<option value="">Select Health Facility...</option>'; facility.disabled = true; }
    if (community) { community.innerHTML = '<option value="">Select Community...</option>'; community.disabled = true; }
    if (school) { school.innerHTML = '<option value="">Select School...</option>'; school.disabled = true; }
    
    // Clear counts
    clearCount('chiefdom'); clearCount('section_loc'); clearCount('facility');
    clearCount('community'); clearCount('school_name');
    
    updateProgress();
    setDefaultDate();
    captureGPS();
    calculateAll();
    
    // Reinitialize signature pads
    setTimeout(() => {
        initAllSignaturePads();
    }, 100);
}

// ============================================
// DOWNLOAD DATA
// ============================================
function downloadData() {
    if (!checkAdmin()) return;

    const allData = [...state.pendingSubmissions, ...state.drafts];
    if (allData.length === 0) {
        showNotification('No data to download.', 'info');
        return;
    }

    const keys = new Set();
    allData.forEach(item => Object.keys(item).forEach(k => keys.add(k)));
    const headers = Array.from(keys);

    let csv = headers.join(',') + '\n';
    allData.forEach(item => {
        csv += headers.map(h => {
            let val = item[h] || '';
            if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
                val = '"' + val.replace(/"/g, '""') + '"';
            }
            return val;
        }).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `itn_data_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Data downloaded!', 'success');
}

// ============================================
// ANALYSIS
// ============================================
function openAnalysisModal() {
    if (!checkAdmin()) return;

    const modal = document.getElementById('analysisModal');
    const body = document.getElementById('analysisBody');

    const allData = [...state.pendingSubmissions, ...state.drafts.filter(d => d.total_pupils)];
    
    if (allData.length === 0) {
        body.innerHTML = '<div class="no-data">No data available for analysis.</div>';
        modal.classList.add('show');
        return;
    }

    let totalSchools = allData.length;
    let totalBoys = 0, totalGirls = 0, totalBoysITN = 0, totalGirlsITN = 0;
    const districtData = {};

    allData.forEach(d => {
        totalBoys += parseInt(d.total_boys) || 0;
        totalGirls += parseInt(d.total_girls) || 0;
        totalBoysITN += parseInt(d.total_boys_itn) || 0;
        totalGirlsITN += parseInt(d.total_girls_itn) || 0;
        
        const dist = d.district || 'Unknown';
        if (!districtData[dist]) districtData[dist] = { schools: 0, pupils: 0, itn: 0 };
        districtData[dist].schools++;
        districtData[dist].pupils += (parseInt(d.total_pupils) || 0);
        districtData[dist].itn += (parseInt(d.total_itn) || 0);
    });

    const totalPupils = totalBoys + totalGirls;
    const totalITN = totalBoysITN + totalGirlsITN;
    const coverage = totalPupils > 0 ? Math.round((totalITN / totalPupils) * 100) : 0;

    body.innerHTML = `
        <div class="analysis-stats">
            <div class="stat-card"><div class="stat-value">${totalSchools}</div><div class="stat-label">Schools Surveyed</div></div>
            <div class="stat-card"><div class="stat-value">${totalPupils.toLocaleString()}</div><div class="stat-label">Total Pupils</div></div>
            <div class="stat-card"><div class="stat-value">${totalITN.toLocaleString()}</div><div class="stat-label">ITNs Distributed</div></div>
            <div class="stat-card green"><div class="stat-value">${coverage}%</div><div class="stat-label">Overall Coverage</div></div>
        </div>
        <div class="analysis-section">
            <h3>Gender Breakdown</h3>
            <div class="analysis-grid">
                <div class="analysis-item"><span class="item-label">Total Boys:</span><span class="item-value">${totalBoys.toLocaleString()}</span></div>
                <div class="analysis-item"><span class="item-label">Total Girls:</span><span class="item-value">${totalGirls.toLocaleString()}</span></div>
                <div class="analysis-item"><span class="item-label">Boys ITN:</span><span class="item-value">${totalBoysITN.toLocaleString()}</span></div>
                <div class="analysis-item"><span class="item-label">Girls ITN:</span><span class="item-value">${totalGirlsITN.toLocaleString()}</span></div>
                <div class="analysis-item"><span class="item-label">Boys Coverage:</span><span class="item-value">${totalBoys > 0 ? Math.round((totalBoysITN/totalBoys)*100) : 0}%</span></div>
                <div class="analysis-item"><span class="item-label">Girls Coverage:</span><span class="item-value">${totalGirls > 0 ? Math.round((totalGirlsITN/totalGirls)*100) : 0}%</span></div>
            </div>
        </div>
        <div class="analysis-section">
            <h3>By District</h3>
            <table class="analysis-table">
                <thead><tr><th>District</th><th>Schools</th><th>Pupils</th><th>ITNs</th><th>Coverage</th></tr></thead>
                <tbody>
                    ${Object.entries(districtData).map(([d, v]) => `
                        <tr><td>${d}</td><td>${v.schools}</td><td>${v.pupils.toLocaleString()}</td><td>${v.itn.toLocaleString()}</td><td>${v.pupils > 0 ? Math.round((v.itn/v.pupils)*100) : 0}%</td></tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
    modal.classList.add('show');
}

function closeAnalysisModal() {
    document.getElementById('analysisModal').classList.remove('show');
}

// ============================================
// UTILITIES
// ============================================
function checkAdmin() {
    const user = prompt('Username:');
    const pass = prompt('Password:');
    if (user === CONFIG.ADMIN_USER && pass === CONFIG.ADMIN_PASS) return true;
    showNotification('Invalid credentials.', 'error');
    return false;
}

function updateOnlineStatus() {
    const indicator = document.getElementById('statusIndicator');
    const text = document.getElementById('statusText');
    if (state.isOnline) {
        indicator.className = 'status-indicator online';
        text.textContent = 'ONLINE';
    } else {
        indicator.className = 'status-indicator offline';
        text.textContent = 'OFFLINE';
    }
}

function updateCounts() {
    document.getElementById('draftCount').textContent = state.drafts.length;
    document.getElementById('pendingCount').textContent = state.pendingSubmissions.length;
}

function showNotification(msg, type) {
    const notif = document.getElementById('notification');
    const text = document.getElementById('notificationText');
    notif.className = 'notification ' + type + ' show';
    text.textContent = msg;
    setTimeout(() => notif.classList.remove('show'), 4000);
}

function setupEventListeners() {
    document.getElementById('viewDataBtn').addEventListener('click', () => {
        if (checkAdmin()) window.open(CONFIG.SHEET_URL, '_blank');
    });
    document.getElementById('downloadDataBtn').addEventListener('click', downloadData);
    document.getElementById('viewAnalysisBtn').addEventListener('click', openAnalysisModal);
    document.getElementById('viewDraftsBtn').addEventListener('click', openDraftsModal);
    document.getElementById('dataForm').addEventListener('submit', handleSubmit);

    window.addEventListener('online', () => { state.isOnline = true; updateOnlineStatus(); syncPending(); });
    window.addEventListener('offline', () => { state.isOnline = false; updateOnlineStatus(); });

    document.querySelectorAll('.modal-overlay').forEach(m => {
        m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); });
    });

    document.getElementById('draftNameInput').addEventListener('keypress', e => {
        if (e.key === 'Enter') confirmSaveDraft();
    });
}

async function syncPending() {
    if (state.pendingSubmissions.length === 0) return;
    showNotification('Syncing pending data...', 'info');
    
    const synced = [];
    for (let i = 0; i < state.pendingSubmissions.length; i++) {
        try {
            await fetch(CONFIG.SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                body: JSON.stringify(state.pendingSubmissions[i])
            });
            synced.push(i);
        } catch (e) {}
    }

    if (synced.length > 0) {
        state.pendingSubmissions = state.pendingSubmissions.filter((_, i) => !synced.includes(i));
        saveToStorage();
        updateCounts();
        showNotification('Synced ' + synced.length + ' submission(s)!', 'success');
    }
}

// Initialize
init();
