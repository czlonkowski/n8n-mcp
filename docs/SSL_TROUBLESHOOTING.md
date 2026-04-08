# SSL/TLS Certificate Troubleshooting Guide

This guide helps you resolve SSL certificate issues when connecting n8n-MCP to your n8n instance.

## 📋 Table of Contents
- [Quick Solutions](#quick-solutions)
- [Understanding the Problem](#understanding-the-problem)
- [Common Errors and Solutions](#common-errors-and-solutions)
- [Creating a Complete Certificate Bundle](#creating-a-complete-certificate-bundle)
- [Diagnostic Commands](#diagnostic-commands)
- [Solutions by Certificate Type](#solutions-by-certificate-type)
- [Best Practices](#best-practices)

## Quick Solutions

| Problem | Quick Fix |
|---------|-----------|
| **UNABLE_TO_VERIFY_LEAF_SIGNATURE** | Add root certificate to your bundle |
| **SELF_SIGNED_CERT_IN_CHAIN** | Use the self-signed cert as CA |
| **Certificate verification failed** | Ensure complete certificate chain |
| **Works with curl but not Node.js** | Node.js needs the full chain including root |

## Understanding the Problem

### Node.js vs curl Behavior

**Important:** Node.js has stricter certificate validation than curl:
- **curl**: Often works with just intermediate certificates
- **Node.js**: Requires the complete certificate chain including the root CA

This is why your n8n instance might work fine in a browser or with curl, but fail with n8n-MCP.

### Certificate Chain Structure

A complete certificate chain consists of:
```
1. Server Certificate (your domain)
   ↓
2. Intermediate Certificate(s) (optional)
   ↓  
3. Root Certificate (trusted CA)
```

Node.js needs ALL three levels to validate the connection.

## Common Errors and Solutions

### 1. UNABLE_TO_VERIFY_LEAF_SIGNATURE

**Error Message:**
```
Error: unable to verify the first certificate
```

**Cause:** Missing root certificate in the chain.

**Solution:**
```bash
# Create a complete bundle with root certificate
cat fullchain.pem root.pem > complete-bundle.pem

# Use the complete bundle
export N8N_CERT_PATH=/path/to/complete-bundle.pem
```

### 2. SELF_SIGNED_CERT_IN_CHAIN

**Error Message:**
```
Error: self signed certificate in certificate chain
```

**Cause:** Using a self-signed certificate without proper configuration.

**Solution:**
```bash
# For self-signed certificates, use the certificate itself as CA
export N8N_CERT_PATH=/path/to/self-signed-cert.pem

# Or if you must, disable verification (development only!)
export N8N_SKIP_SSL_VERIFICATION=true
```

### 3. CERT_HAS_EXPIRED

**Error Message:**
```
Error: certificate has expired
```

**Cause:** The SSL certificate has passed its expiration date.

**Solution:**
```bash
# Check certificate expiration
openssl x509 -in cert.pem -noout -dates

# Renew your certificate through your certificate provider:
# - Let's Encrypt: certbot renew
# - Commercial CA: Contact your provider or use their portal
# - Self-signed: Generate a new certificate
```

### 4. ERR_TLS_CERT_ALTNAME_INVALID

**Error Message:**
```
Error: Hostname/IP does not match certificate's altnames
```

**Cause:** The certificate doesn't match the domain you're connecting to.

**Solution:**
```bash
# Check certificate domains
openssl x509 -in cert.pem -noout -text | grep -A1 "Subject Alternative Name"

# Ensure N8N_API_URL matches the certificate domain
export N8N_API_URL=https://correct-domain.com
```

### 5. Incomplete Certificate Chain

**Error Message:**
```
Error: unable to get local issuer certificate
```

**Cause:** Missing intermediate or root certificates.

**Solution:** Create a complete certificate bundle (see next section).

## Creating a Complete Certificate Bundle

### For Let's Encrypt Certificates

Let's Encrypt certificates often need the ISRG Root X1 certificate:

```bash
# 1. Download ISRG Root X1 (Let's Encrypt root)
wget https://letsencrypt.org/certs/isrgrootx1.pem

# 2. Create complete bundle (order matters!)
cat /etc/letsencrypt/live/yourdomain/fullchain.pem isrgrootx1.pem > complete-bundle.pem

# 3. Use the complete bundle
export N8N_CERT_PATH=/path/to/complete-bundle.pem
```

### Certificate Bundle Order

The correct order in your PEM file should be:
```
-----BEGIN CERTIFICATE-----
[Your server certificate]
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
[Intermediate certificate]
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
[Root certificate]
-----END CERTIFICATE-----
```

### Verify Your Bundle

```bash
# Verify the certificate chain
openssl verify -CAfile complete-bundle.pem complete-bundle.pem

# Should output: complete-bundle.pem: OK
```

## Diagnostic Commands

### 1. Test SSL Connection

```bash
# Test with openssl
openssl s_client -connect your-n8n-instance.com:443 -showcerts

# Test with Node.js (same as n8n-MCP)
node -e "
const https = require('https');
const fs = require('fs');
const ca = fs.readFileSync('complete-bundle.pem');
https.get('https://your-n8n-instance.com', {ca}, (res) => {
  console.log('Success! Status:', res.statusCode);
}).on('error', (e) => {
  console.error('Error:', e.message);
});
"
```

### 2. Debug TLS Issues

```bash
# Enable Node.js TLS debugging
NODE_DEBUG=tls node your-script.js

# This will show detailed TLS handshake information
```

### 3. Inspect Certificate Details

```bash
# View certificate information
openssl x509 -in cert.pem -text -noout

# Check certificate chain
openssl crl2pkcs7 -nocrl -certfile fullchain.pem | \
  openssl pkcs7 -print_certs -text -noout | \
  grep -E "Subject:|Issuer:"
```

### 4. Compare curl vs Node.js

```bash
# Test with curl (often works)
curl -v https://your-n8n-instance.com

# Test with Node.js (might fail without root cert)
node -e "require('https').get('https://your-n8n-instance.com', r => console.log('OK')).on('error', e => console.error(e.message))"
```

## Solutions by Certificate Type

### Let's Encrypt / Certbot

```bash
# Standard setup
export N8N_CERT_PATH=/etc/letsencrypt/live/yourdomain/fullchain.pem

# If that fails, create bundle with root
cat /etc/letsencrypt/live/yourdomain/fullchain.pem \
    <(wget -qO- https://letsencrypt.org/certs/isrgrootx1.pem) \
    > /tmp/complete-bundle.pem
export N8N_CERT_PATH=/tmp/complete-bundle.pem
```

### Self-Signed Certificates

```bash
# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Use the certificate itself as CA
export N8N_CERT_PATH=/path/to/cert.pem
```

### Corporate/Custom CA

```bash
# Get your CA certificate from IT department
# Combine if necessary
cat server-cert.pem intermediate-ca.pem root-ca.pem > bundle.pem
export N8N_CERT_PATH=/path/to/bundle.pem
```

### CloudFlare Origin Certificates

```bash
# Download CloudFlare's origin CA
wget https://developers.cloudflare.com/ssl/static/origin_ca_rsa_root.pem

# Use as CA
export N8N_CERT_PATH=/path/to/origin_ca_rsa_root.pem
```

## Best Practices

### 1. Always Test Your Configuration

```bash
# Create a test script
cat > test-ssl.js << 'EOF'
const https = require('https');
const fs = require('fs');

const ca = fs.readFileSync(process.env.N8N_CERT_PATH);
const url = process.env.N8N_API_URL;

https.get(url, {ca}, (res) => {
  console.log('✅ SSL connection successful!');
  console.log('Status:', res.statusCode);
  process.exit(0);
}).on('error', (e) => {
  console.error('❌ SSL connection failed:', e.message);
  process.exit(1);
});
EOF

node test-ssl.js
```

### 2. Security Recommendations

1. **Never use `N8N_SKIP_SSL_VERIFICATION` in production**
2. **Keep certificates up to date** - Set up auto-renewal
3. **Use proper certificate storage** - Secure file permissions (600 or 400)
4. **Monitor expiration dates** - Set up alerts

### 3. Certificate File Permissions

```bash
# Secure your certificate files
chmod 600 /path/to/cert.pem
chown $USER:$USER /path/to/cert.pem
```

## Still Having Issues?

If you're still experiencing problems:

1. **Verify the basics:**
   ```bash
   # Check file exists and is readable
   ls -la $N8N_CERT_PATH
   
   # Check it's valid PEM format
   openssl x509 -in $N8N_CERT_PATH -text -noout
   ```

2. **Try the nuclear option (development only!):**
   ```bash
   export N8N_SKIP_SSL_VERIFICATION=true
   ```
   ⚠️ **WARNING**: This completely disables SSL verification and should NEVER be used in production.

3. **Get help:**
   - Check the [main troubleshooting guide](../README.md#troubleshooting)
   - Open an issue on [GitHub](https://github.com/czlonkowski/n8n-mcp/issues)
   - Include your error message and `NODE_DEBUG=tls` output

## Summary

The key points to remember:

1. **Node.js needs the complete certificate chain** including the root certificate
2. **Certificate order matters**: Server → Intermediate → Root
3. **Test with Node.js**, not just curl or browsers
4. **Use `openssl verify`** to validate your certificate bundle
5. **Enable `NODE_DEBUG=tls`** for detailed debugging information

When in doubt, create a complete bundle with all certificates and use that with `N8N_CERT_PATH`.