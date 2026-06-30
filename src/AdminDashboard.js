import React, { useEffect, useState } from 'react';

const AdminDashboard = () => {
  const [stats, setStats] = useState(null);
  const [newFee, setNewFee] = useState('');

  useEffect(() => {
    fetch('http://localhost:3005/v1/admin/dashboard')
      .then(res => res.json())
      .then(setStats);
  }, []);

  const updateFee = async () => {
    await fetch('http://localhost:3005/v1/admin/config/fee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feeRate: parseFloat(newFee) })
    });
    alert('Fee updated successfully');
  };

  if (!stats) return <div>Loading Admin...</div>;

  return (
    <div style={{ padding: '20px' }}>
      <h1>Atomic Admin Dashboard</h1>
      <div>
        <p>Total Volume: {stats.metrics.total_settled_volume_fiat}</p>
        <p>Completed Transactions: {stats.metrics.completed_settlements}</p>
      </div>
      <hr />
      <h3>Global Fee Management</h3>
      <input 
        type="number" 
        placeholder="e.g., 0.015 for 1.5%" 
        onChange={(e) => setNewFee(e.target.value)} 
      />
      <button onClick={updateFee}>Update Global Platform Fee</button>
    </div>
  );
};

export default AdminDashboard;
