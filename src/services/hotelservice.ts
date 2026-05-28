export async function getNearbyHotels(
  lat: number,
  lng: number
) {
  const query = `
    [out:json];
    (
      node["tourism"="hotel"](around:5000,${lat},${lng});
      node["tourism"="guest_house"](around:5000,${lat},${lng});
      node["tourism"="hostel"](around:5000,${lat},${lng});
    );
    out;
  `;

  try {
    const res = await fetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        body: query,
      }
    );

    const data = await res.json();

    return data.elements.map((hotel: any) => ({
      name:
        hotel.tags?.name ||
        "Unnamed Stay",

      type:
        hotel.tags?.tourism === "hotel"
          ? "comfort"
          : hotel.tags?.tourism === "hostel"
          ? "budget"
          : "standard",

      pricePerNight:
        hotel.tags?.tourism === "hotel"
          ? 3500
          : hotel.tags?.tourism === "hostel"
          ? 900
          : 1800,

      rating: 4.0,

      amenities: [
        "WiFi",
        "Hot Water",
      ],

      lat: hotel.lat,
      lng: hotel.lon,
    }));
  } catch (err) {
    console.error(
      "Hotel fetch failed:",
      err
    );

    return [];
  }
}