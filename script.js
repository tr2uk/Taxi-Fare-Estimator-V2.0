// === CONFIGURATION ===
// Rother District Council Official Fare Table (24 April 2023)

const RATES = {
    tariff1: { 
        name: 'Tariff 1 (Standard)',
        flagFall: 3.30,
        incrementRate: 0.20,
        firstMileYards: 138.1,
        afterMileYards: 167.6
    },
    tariff2: { 
        name: 'Tariff 2 (Night/Sunday/Holiday)',
        flagFall: 4.80,
        incrementRate: 0.30,
        firstMileYards: 138.1,
        afterMileYards: 167.6
    },
    tariff3: { 
        name: 'Tariff 3 (Christmas/Boxing/New Year)',
        flagFall: 6.40,
        incrementRate: 0.40,
        firstMileYards: 138.1,
        afterMileYards: 167.6
    }
};

const BANK_HOLIDAYS_2025 = [
    "2025-01-01", "2025-04-18", "2025-04-21", "2025-05-05",
    "2025-05-26", "2025-08-25", "2025-12-25", "2025-12-26"
];

const BANK_HOLIDAYS_2026 = [
    "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04",
    "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28"
];

const ROTHER_POSTCODES = [
    "TN31", "TN32", "TN33", "TN36", "TN37", "TN38", "TN39", "TN40"
];

// Global variables
let currentJourneyData = {};
const routeDatabase = JSON.parse(localStorage.getItem('villageTaxiRoutes')) || {};

// === DOĞRU FARE HESAPLAMA (DÜZELTİLDİ - Resmi tarife ile tam uyumlu) ===
function calculateMeterFare(distanceMiles, tariff) {
    const yardsPerMile = 1760;
    const totalYards = distanceMiles * yardsPerMile;
    
    let fare = tariff.flagFall; // İlk 138.1 yards dahil
    let remainingYards = totalYards - tariff.firstMileYards;
    
    if (remainingYards <= 0) {
        return parseFloat(fare.toFixed(2));
    }
    
    // İlk milin kalan kısmı (1760 - 138.1 = 1621.9 yards) için increment: 138.1 yards
    const firstMileRemainingYards = yardsPerMile - tariff.firstMileYards;
    const firstMileRemaining = Math.min(remainingYards, firstMileRemainingYards);
    const incrementsInFirstMile = Math.ceil(firstMileRemaining / tariff.firstMileYards);
    fare += incrementsInFirstMile * tariff.incrementRate;
    
    remainingYards -= firstMileRemaining;
    
    // 1 milden sonrası için increment: 167.6 yards
    if (remainingYards > 0) {
        const incrementsAfter = Math.ceil(remainingYards / tariff.afterMileYards);
        fare += incrementsAfter * tariff.incrementRate;
    }
    
    return parseFloat(fare.toFixed(2));
}

// === POSTCODE VALIDATION ===
function isWithinLicenceArea(postcode) {
    const cleanCode = postcode.replace(/\s/g, '').toUpperCase();
    const district = cleanCode.substring(0, 4);
    return ROTHER_POSTCODES.includes(district);
}

// === TAB SWITCHING ===
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById('tab-' + tabName).classList.add('active');
    document.querySelectorAll('.tab-btn')[tabName === 'postcode' ? 0 : 1].classList.add('active');
    
    hideResults();
}

// === TARIFF SELECTION ===
function getTariffType(dateString, timeString) {
    const date = new Date(dateString);
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const dayOfWeek = date.getDay();
    const hour = parseInt(timeString.split(':')[0]);

    // Tariff 3: Christmas Day, Boxing Day, New Year's Day
    if ((month === 12 && day === 25) || (month === 12 && day === 26) || (month === 1 && day === 1)) {
        return { name: 'Tariff 3 (Christmas Period)', rate: RATES.tariff3 };
    }

    // Tariff 2: Christmas Eve & New Year's Eve after 18:00
    if ((month === 12 && day === 24 && hour >= 18) || (month === 12 && day === 31 && hour >= 18)) {
        return { name: 'Tariff 2 (Holiday Eve)', rate: RATES.tariff2 };
    }

    // Tariff 2: Night time (23:00 - 05:59)
    if (hour >= 23 || hour < 6) {
        return { name: 'Tariff 2 (Night-time)', rate: RATES.tariff2 };
    }

    // Tariff 2: Sundays and Bank Holidays
    const allBankHolidays = [...BANK_HOLIDAYS_2025, ...BANK_HOLIDAYS_2026];
    if (dayOfWeek === 0 || allBankHolidays.includes(dateString)) {
        return { name: 'Tariff 2 (Sunday/Holiday)', rate: RATES.tariff2 };
    }

    // Default: Tariff 1
    return { name: 'Tariff 1 (Standard)', rate: RATES.tariff1 };
}

// === POSTCODE GEOCODING ===
async function validateAndGeocode(postcode) {
    const cleanPostcode = postcode.replace(/\s/g, '').toUpperCase();
    
    try {
        const response = await fetch(`https://api.postcodes.io/postcodes/${cleanPostcode}`);
        if (!response.ok) throw new Error('Invalid postcode');
        
        const data = await response.json();
        
        if (data.status === 200 && data.result) {
            return {
                postcode: data.result.postcode,
                latitude: data.result.latitude,
                longitude: data.result.longitude,
                area: data.result.admin_district || 'Unknown'
            };
        } else {
            throw new Error('Postcode not found');
        }
    } catch (_error) {
        return null;
    }
}

// === DISTANCE CALCULATION (Haversine + Road Factor) ===
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const straightLineDistance = R * c;
    
    const roadFactor = 1.40; // Straight-line mesafeye yol faktörü
    return straightLineDistance * roadFactor;
}

// === ROUTE TRACKING ===
function trackRoute(pickup, destination, distance) {
    const routeKey = `${pickup}→${destination}`;
    
    if (!routeDatabase[routeKey]) {
        routeDatabase[routeKey] = {
            count: 0,
            totalDistance: 0,
            firstSearched: new Date().toISOString()
        };
    }
    
    routeDatabase[routeKey].count += 1;
    routeDatabase[routeKey].totalDistance += distance;
    routeDatabase[routeKey].lastSearched = new Date().toISOString();
    routeDatabase[routeKey].avgDistance = (routeDatabase[routeKey].totalDistance / routeDatabase[routeKey].count).toFixed(1);
    
    localStorage.setItem('villageTaxiRoutes', JSON.stringify(routeDatabase));
}

// === CALCULATE FARE BY POSTCODE ===
async function calculateFareByPostcode() {
    const pickupInput = document.getElementById('pickup-postcode').value.trim();
    const destInput = document.getElementById('destination-postcode').value.trim();
    const dateStr = document.getElementById('travelDate-postcode').value;
    const timeStr = document.getElementById('travelTime-postcode').value;

    if (!pickupInput || !destInput || !dateStr || !timeStr) {
        alert("Please fill in all fields.");
        return;
    }

    const selectedDate = new Date(dateStr + 'T' + timeStr);
    const now = new Date();
    if (selectedDate < now) {
        alert("⚠️ Cannot calculate fare for past dates.\n\nPlease select a future date and time.");
        return;
    }

    if (!isWithinLicenceArea(pickupInput)) {
        alert(`⚠️ Pick-up location is outside our service area.\n\nVillage Taxi Rye operates from Rother District Council area only.\n\nAccepted pick-up postcodes: ${ROTHER_POSTCODES.join(', ')}\n\n✅ Destination can be anywhere in the UK.`);
        return;
    }

    const btn = document.getElementById('calc-postcode-btn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Calculating...';
    btn.disabled = true;

    try {
        const pickupGeo = await validateAndGeocode(pickupInput);
        const destGeo = await validateAndGeocode(destInput);

        if (!pickupGeo) {
            alert('Invalid pick-up postcode. Please check and try again.');
            return;
        }
        if (!destGeo) {
            alert('Invalid destination postcode. Please check and try again.');
            return;
        }

        const distance = calculateDistance(pickupGeo.latitude, pickupGeo.longitude, destGeo.latitude, destGeo.longitude);
        trackRoute(pickupGeo.postcode, destGeo.postcode, distance);

        const tariffInfo = getTariffType(dateStr, timeStr);
        const price = calculateMeterFare(distance, tariffInfo.rate);

        currentJourneyData = {
            pickup: pickupGeo.postcode,
            destination: destGeo.postcode,
            date: dateStr,
            time: timeStr,
            distance: distance.toFixed(1),
            price: price.toFixed(2),
            tariff: tariffInfo.name,
            method: 'postcode'
        };

        displayResults();

    } catch (_error) {
        console.error('Calculation error:', error);
        alert('An error occurred. Please try again.');
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

// === CALCULATE FARE BY DISTANCE ===
function calculateFareByDistance() {
    const distanceInput = document.getElementById('distance-miles').value;
    const dateStr = document.getElementById('travelDate-distance').value;
    const timeStr = document.getElementById('travelTime-distance').value;

    if (!distanceInput || !dateStr || !timeStr) {
        alert("Please fill in all fields.");
        return;
    }

    const selectedDate = new Date(dateStr + 'T' + timeStr);
    const now = new Date();
    if (selectedDate < now) {
        alert("⚠️ Cannot calculate fare for past dates.\n\nPlease select a future date and time.");
        return;
    }

    const distance = parseFloat(distanceInput);
    if (distance < 0.5 || distance > 100) {
        alert("Distance must be between 0.5 and 100 miles.");
        return;
    }

    const tariffInfo = getTariffType(dateStr, timeStr);
    const price = calculateMeterFare(distance, tariffInfo.rate);

    currentJourneyData = {
        pickup: 'Manual Entry',
        destination: 'Manual Entry',
        date: dateStr,
        time: timeStr,
        distance: distance.toFixed(1),
        price: price.toFixed(2),
        tariff: tariffInfo.name,
        method: 'distance'
    };

    displayResults();
}

// === DISPLAY RESULTS ===
function displayResults() {
    // Fiyat
    document.getElementById('priceAmount').innerText = currentJourneyData.price;

    // Rota (sadece postcode için göster)
    const routeInfo = document.getElementById('routeInfo');
if (currentJourneyData.method === 'postcode') {
    routeInfo.innerText = `${currentJourneyData.pickup} → ${currentJourneyData.destination}`;
    routeInfo.style.display = 'block';
} else {
    routeInfo.style.display = 'none';
}

    // Mesafe
    document.getElementById('distanceDisplay').innerText = currentJourneyData.distance + ' miles';

    // Tarife başlığı
    document.getElementById('tariffDisplay').innerText = currentJourneyData.tariff.split(' (')[0] + ' Applied';

    // Tarife açıklaması (italik altında)
    let tariffDesc = '';
    if (currentJourneyData.tariff.includes('Tariff 1')) {
        tariffDesc = 'Standard rate (Mon-Sat, 06:00-23:00)';
    } else if (currentJourneyData.tariff.includes('Tariff 2')) {
        tariffDesc = 'Night, Sunday or Bank Holiday rate';
    } else if (currentJourneyData.tariff.includes('Tariff 3')) {
        tariffDesc = 'Christmas / New Year rate';
    }
    document.getElementById('tariff-desc').innerText = tariffDesc;

    // Hesaplayıcıyı gizle, sonucu göster
    hideCalculators();
    document.getElementById('result-section').classList.remove('hidden');
}

// === QUOTE MODAL ===
function openQuoteModal() {
    document.getElementById('q_pickup').value = currentJourneyData.pickup || '';
    document.getElementById('q_destination').value = currentJourneyData.destination || '';
    document.getElementById('q_date').value = currentJourneyData.date || '';
    document.getElementById('q_time').value = currentJourneyData.time || '';
    
    document.getElementById('quote-modal').classList.remove('hidden');
}

function closeQuoteModal() {
    document.getElementById('quote-modal').classList.add('hidden');
}

// === SUBMIT QUOTE (EmailJS Template ID DÜZELTİLDİ) ===
function submitQuote(event) {
    event.preventDefault();
    
    const btn = event.target.querySelector('button[type="submit"]');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    btn.disabled = true;

    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());

    const templateParams = {
        to_name: "Village Taxi Rye",
        from_name: data.name,
        from_email: data.email,
        phone: data.phone,
        pickup: currentJourneyData.pickup,
        destination: currentJourneyData.destination,
        date: currentJourneyData.date,
        time: currentJourneyData.time,
        price: currentJourneyData.price,
        distance: currentJourneyData.distance,
        tariff_type: currentJourneyData.tariff,
        contact_method: data.contactMethod,
        calculation_method: currentJourneyData.method
    };

    const serviceID = "service_9b3qgjg";
    const templateID = "template_p7gtstt";  

    emailjs.send(serviceID, templateID, templateParams)
        .then(() => {
            closeQuoteModal();
            hideResults();
            document.getElementById('success-message').classList.remove('hidden');
        }, (error) => {
            console.error('Email error:', error);
            alert('Error sending request. Please call us directly.');
        })
        .finally(() => {
            btn.innerHTML = originalHTML;
            btn.disabled = false;
        });
}

// === RESET & UTILITY ===
function resetCalculator() {
    document.querySelectorAll('input[type="text"], input[type="number"], input[type="date"], input[type="time"]').forEach(input => input.value = '');
    document.getElementById('success-message').classList.add('hidden');
    hideResults();
    switchTab('postcode');
}

function hideCalculators() {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
}

function hideResults() {
    document.getElementById('result-section').classList.add('hidden');
}

// === BUTTON EVENT LISTENERS (Daha güvenli bağlantı) ===
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('calc-postcode-btn').addEventListener('click', calculateFareByPostcode);
    document.getElementById('calc-distance-btn').addEventListener('click', calculateFareByDistance);
});

// === DEBUG & EXPORT (Konsol için) ===
function exportPopularRoutes() {
    const popular = Object.entries(routeDatabase)
        .filter(([_, data]) => data.count >= 3)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([route, data]) => ({
            route,
            searches: data.count,
            avgDistance: data.avgDistance,
            lastSearched: data.lastSearched
        }));
    console.table(popular);
    return popular;
}

function testFareCalculation() {
    console.log("=== Rother Council Fare Test ===");
    console.log("Tariff 2 - 12.2 miles:", calculateMeterFare(12.2, RATES.tariff2).toFixed(2)); // ~40.80
    console.log("Tariff 1 - 5 miles:", calculateMeterFare(5, RATES.tariff1).toFixed(2));
    console.log("Tariff 2 - 11.2 miles:", calculateMeterFare(11.2, RATES.tariff2).toFixed(2));
}

window.exportPopularRoutes = exportPopularRoutes;
window.testFareCalculation = testFareCalculation;
