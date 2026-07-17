# Deploying Rackpad on Kubernetes

Plain, dependency-free manifests for running Rackpad on any Kubernetes cluster.
They mirror [`docker-compose.yml`](../../docker-compose.yml): a single replica,
a non-root container, a read-only root filesystem, and the SQLite database on a
PersistentVolume.

## Quick start

```bash
# Apply everything (namespace, PVC, deployment, service):
kubectl apply -k deploy/kubernetes/

# ...or apply the files individually:
kubectl apply -f deploy/kubernetes/namespace.yaml
kubectl apply -f deploy/kubernetes/pvc.yaml
kubectl apply -f deploy/kubernetes/deployment.yaml
kubectl apply -f deploy/kubernetes/service.yaml
```

Reach the UI with a port-forward:

```bash
kubectl -n rackpad port-forward svc/rackpad 3000:3000
# open http://localhost:3000
```

To expose it permanently, edit and apply [`ingress.yaml`](./ingress.yaml)
(set the host, `ingressClassName`, and TLS), or use a LoadBalancer service.

## What's in here

| File | Purpose |
| --- | --- |
| `namespace.yaml` | `rackpad` namespace |
| `pvc.yaml` | 2Gi RWO volume for the SQLite DB at `/data` |
| `deployment.yaml` | Single-replica, non-root, read-only-rootfs deployment |
| `service.yaml` | ClusterIP service on port 3000 |
| `ingress.yaml` | Optional ingress example (commented defaults) |
| `kustomization.yaml` | Bundles the core resources for `kubectl apply -k` |

## Notes

- **Image tag** — the manifests use `:latest`. Pin to a
  [released tag](https://github.com/Kobii-git/rackpad/releases) for production.
- **Storage** — the PVC uses the cluster's default StorageClass. SQLite relies
  on file locking, so prefer block storage (iSCSI, local-path, Ceph RBD) over
  NFS. Never run more than one replica (`strategy: Recreate`, `replicas: 1`).
- **Configuration** — every environment variable from the Compose files is
  supported. The deployment sets the common ones; uncomment `APP_URL` /
  `TRUST_PROXY` when running behind an ingress, and add the `OIDC_*` variables
  to enable SSO (see [`docs/OIDC.md`](../../docs/OIDC.md)).

## Network discovery on Kubernetes

Discovery and SNMP have networking requirements that the minimal-privilege
deployment above deliberately does **not** grant. See
[`docs/DISCOVERY_DEPLOYMENT.md`](../../docs/DISCOVERY_DEPLOYMENT.md) for the full
background; the short version for Kubernetes:

- **Layer-3 scans (ICMP / TCP / HTTP reachability) and SNMP discovery** work
  from a normal pod — they only need routing to your device subnets plus a raw
  socket. Grant `NET_RAW` (and `NET_BIND_SERVICE` for the SNMP trap listener).
  Because Kubernetes can't give ambient capabilities to a non-root uid, run the
  container as root with everything else dropped:

  ```yaml
  # deployment.yaml — pod securityContext:
  securityContext:
    runAsUser: 0
    runAsGroup: 0
    fsGroup: 0
  # ...and the container securityContext:
  securityContext:
    allowPrivilegeEscalation: false
    readOnlyRootFilesystem: true
    capabilities:
      add: ["NET_RAW", "NET_BIND_SERVICE"]
      drop: ["ALL"]
  ```

- **Layer-2 scans (ARP / MAC capture)** require the pod to share a broadcast
  domain with the targets — a normal pod on a routed CNI cannot see client MACs
  and will return empty results. To capture MACs on the node's own subnet, also
  set `hostNetwork: true` and add `NET_ADMIN` (the equivalent of
  [`docker-compose.host-discovery.yml`](../../docker-compose.host-discovery.yml)'s
  `network_mode: host`). For devices on other VLANs, prefer SNMP against your
  switches instead.
