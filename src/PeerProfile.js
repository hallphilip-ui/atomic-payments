import React, { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';

const PeerProfile = ({ userId }) => {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`http://localhost:3005/v1/users/${userId}/network_directory`)
      .then(res => res.json())
      .then(setData);
  }, [userId]);

  if (!data) return <div>Loading Profile...</div>;

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>@{data.username}'s Atomic Pay Profile</h1>
      {data.connections.map(conn => (
        <div key={conn.username} style={{ border: '1px solid #ccc', margin: '10px', padding: '10px' }}>
          <h3>Pay {conn.username}</h3>
          {conn.availableAddresses.map(addr => (
            <div key={addr.chain} style={{ marginBottom: '20px' }}>
              <p>{addr.chain}: <code>{addr.address}</code></p>
              <div style={{ background: 'white', padding: '10px', display: 'inline-block' }}>
                <QRCode value={addr.address} size={128} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default PeerProfile;
