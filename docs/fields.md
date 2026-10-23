# Observed request fields

Source: local Surge 6.10.0 (12500), Controller 25. This is the union of 200 recent records and watch samples, not an official fixed schema. Fields may be absent; unknown fields are retained in JSONB.

| CLI field | Observed JSON type |
|---|---|
| `URL` | string |
| `completed` | boolean |
| `completedDate` | number |
| `deviceName` | string |
| `engineIdentifier` | number |
| `failed` | boolean |
| `id` | number |
| `inBytes` | number |
| `inCurrentSpeed` | number |
| `inMaxSpeed` | number |
| `interface` | string |
| `local` | boolean |
| `localAddress` | string |
| `method` | string |
| `modified` | boolean |
| `notes` | array |
| `originalPolicyName` | string |
| `outBytes` | number |
| `outCurrentSpeed` | number |
| `outMaxSpeed` | number |
| `pathForStatistics` | string |
| `pid` | number |
| `policyName` | string |
| `processPath` | string |
| `rejected` | boolean |
| `remark` | string |
| `remoteAddress` | string |
| `remoteHost` | string |
| `replica` | boolean |
| `rule` | string |
| `setupCompletedDate` | number |
| `sourceAddress` | string |
| `sourcePort` | number |
| `startDate` | number |
| `status` | string |
| `streamHasRequestBody` | boolean |
| `streamHasResponseBody` | boolean |
| `takeoverMode` | number |
| `timingRecords` | array |

`startDate`, `setupCompletedDate`, and `completedDate` are Unix seconds, with fractional precision; zero indicates no corresponding timestamp yet. `inBytes` and `outBytes` are cumulative per-request bytes and must not be summed across snapshots. Observed `timingRecords` elements contain `name`, `duration`, and `durationInMillisecond`. `notes` is an ordered string array. `method` can be HTTPS or TCP and is not necessarily an HTTP method.
