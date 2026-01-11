import React from 'react';
import { SafeAreaView, Text, StyleSheet, StatusBar } from 'react-native';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Text style={styles.title}>Customer App</Text>
      <Text>Welcome to Proximity-Verified Delivery</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
});