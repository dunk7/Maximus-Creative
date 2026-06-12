# Oracle VCN — open ports (required once)

If SSH or deploy times out, add these in Oracle Console:

1. **Networking** → **Virtual cloud networks** → your VCN
2. **Security lists** → default security list (or your subnet's list)
3. **Add ingress rules:**

| Source CIDR | Protocol | Dest port | Description |
|-------------|----------|-----------|-------------|
| `0.0.0.0/0` | TCP | 22 | SSH |
| `0.0.0.0/0` | TCP | 4747 | Maximus wake/status |

4. **Save**

Then test from your laptop:

```bash
ssh -i ~/.ssh/id_ed25519 opc@167.234.214.140
```
