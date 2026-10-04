const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwicm9sZSI6InN0YWZmIiwidXNlcm5hbWUiOiJhZG1pbiIsImlhdCI6MTc5MTExNzk3NCwiZXhwIjoxNzkxMTIxNTc0fQ.W3a5lDGhu3fH2FeZcyJUEmw1NiVQ92cqzYkZR5kuD6I';

async function testApi() {
  try {
    const res = await fetch('http://localhost:5000/api/motorcycles/rentals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        motor_id: 2,
        start_datetime: '2026-10-10T10:00:00',
        expected_return_datetime: '2026-10-11T10:00:00',
        license_type: 'PH',
        driver_license_number: 'A12-34-567890',
        driver_license_expiry: '2030-01-01',
        driver_license_restrictions: 'A1',
        initial_payment: 100
      })
    });
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Response:", text);
  } catch (err) {
    console.error(err);
  }
}
testApi();
