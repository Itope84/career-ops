import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { execSync } from 'child_process';

const rawCandidates = [
  // Query 1
  { portal: "Ashby — Senior Frontend", company: "HTTPie", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHZCvZp9GHiKjsqDMSL929b0_5hSudGW00WKt3YbHYnUWPz4b4tqaPFmX9p56904ltN7TKrC07zBB5BsAHIOeo_3JcozCa6GscPq5n7LjohJVbNQ7ZC9vM7CTGLitlZZPCAGwtI5WTmcTIxA_1gIwxVLX0fKLh3FlUO9A==" },
  { portal: "Ashby — Senior Frontend", company: "Close", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHgabNI_kId0MQSZsuZFKnOshDkBQ4fcDLPla4RiLjCctlLaOjOENnzUeqiNegP5bmIzJPDk6FTDDeJmGJfnTZlFSL86SECWX13N2bZmiykRj1WXIDcC5cRWi7isqHX5eD0Bg3Wtqyfy8HLCYwVYlGDq9MzkIQOkbrE" },
  { portal: "Ashby — Senior Frontend", company: "Provable", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEJKSiUhLEgUjpr_FWeuuv0nIrVUWxy0hr1UpBdyp_tyLdsioIboIHc6VxAD40bFEmJVJszPGTSeLzXq5UvIY6eF2RBxOqeHAYTa1XbN2iEs9IAc5IZvdBacj_18ul4k0LoXcSX3fVvC-1fEeGfkb1--KkIsYcUfmdKnVEP" },
  { portal: "Ashby — Senior Frontend", company: "Deepgram", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQExW4cSyocKdHNI3uvF4L96s3V2GS80FTIJtOvWKTVwB2MT09bTJKGp52i25jgZNcx_NnUm1YME26SizyAJyhdQHCFklfIFTX6nOVpOfufMTWqOpakRsNhVLwwOjJem7B662tKW-Hp2BhNJITUm1id-Nzm5VDvCJeimGDv0" },
  { portal: "Ashby — Senior Frontend", company: "Grid", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFNwLn-6OxGapyXHRIyMgu_3--DT26u_QS_i_uW8T-EhlYJU5jRh3f7tyuDaO5SJpHrUitxylRqPIgbk_3lwtAg-lSkRWQEL_INJgp_qObc21oGJper5U_G-rcO15Tuu8bfdHJFGMWn4uUFEBLQq38s7qid6LlIwlsg8byXkeQ=" },
  { portal: "Ashby — Senior Frontend", company: "Hiive", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGXRt7vIqX9tz5lZ3m_D5cKuqNRIKaJCZVhHQ4RcB7Y5004csvOu5A3tbF5_8hzuFsJktI-BRSIRW7LxZoPu_Ru4OOP3npif4ub7IpDJjsbBAnDeurC19wT1yrHjHfOSZmbnfr7GBW7Iapsj2ATQB3OWxk87nU7gOnG" },
  { portal: "Ashby — Senior Frontend", company: "Tailor", title: "Senior Frontend Engineer (Frontend Platform)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFQ7HGLPKszG2rprQlmD10PfeCYN5Ls2_7ooBVRH9R8nFm9M9YJOXtOxiY07QXV3qYYt8V7qKoTsEoXTMN-S7EslMBaWfLJSmDKHVSD6pbc8uwkfL3OvMd5Tn61GXCK1bxmEer9tpt_3DbQRiiQlCSrc9DqRKgpLEJ0cA==" },
  { portal: "Ashby — Senior Frontend", company: "Reedsy", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEy79Liz_3x4Ho4czFWo1eevMuP_M121t6UcfCtHnqXlZ7DxCH1tHqdSOWg92H2WAG_Zhc7XMVydLVepcx9tdZhrFXLBxxlFEQbHhhr0KEjrd5ESTM14nM8RcaklzVM-w97ESEXG34IZcFydMAT9yQz1LokJBrVPU5o8w==" },
  { portal: "Ashby — Senior Frontend", company: "ClickUp", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEOC1K6oDjam-b70hHKTl2wdx2XtfI7T3hxkWIAFCh0WbMC36sPqS5qLcNVl57T2aTBJen-TuegKtpSmEDsEtOb2c0gSn8_D9HNTtlosZFHClvzbwPaoIuE6oNKzP4oiDxY3o7UC6c30WAyccZtpgMkJiAvlWUmlhZ22KI=" },
  { portal: "Ashby — Senior Frontend", company: "ClickUp", title: "Staff Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGSRwpU9qtXXuRbiGONaAWBCI_teVibUlWFgXrAuSVzTTVBsfhvigpQz8DbNBxEwAht6CPv8bTEH5NdumIjt14dcfFNEWb2b1VTZuS8JvzAc5qKbt8RVlczwjFvA5Id2K1VGJKPxeRVH75EYwuAi5b7GzPleKn5ffFdmsrVtgdskPHU_k8=" },
  { portal: "Ashby — Senior Frontend", company: "ClickUp (Poland/Bulgaria/etc.)", title: "Staff Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGkNAE9gUuIOLTG3wAv6PmdMPz9hRzNlW_iytKjOMliQWymEG-4d-MYN38_Y_0xWVpWLvw8jl4Cp7JKunXQuTyBysqWV6PN6ZLNHhJNZRimjUuQkme2OeeR00eWzS6V_IPpL3HqA8YlB2tssaKflWVa83RgMBEHvVg7OgpTVBuimbm02Jk=" },
  { portal: "Ashby — Senior Frontend", company: "Vetcove", title: "Staff Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEkDrfbAVyQP3qgkQK9c6LOjkNFOBAuSFukbXqK6qrHo9hIzgvKet-oFEwEmfc4HhuBVE9U8LqgsHeY1C_PFVdN6Mg9ru3YfEu_5U0e5qL1t4UoZlGwkIoDFItyrKuG3XGZmMh8zDh4ReYWFJ5LXDJ3xr2kwa2Ebj2xbyM=" },
  { portal: "Ashby — Senior Frontend", company: "Douro Labs", title: "Staff Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGCQUe2QzDxEIdjdQYK6YmR14SF8glIvQlVj9CrdzGF2ASqJsFB_RbReG8KvOrKw8VI6qI4UZJJzAT793fo8kRYT3p_MDDU_Hps6vD5MBkZ9IxhLNtiRjrS2GkUL_qEFZLmI0eieRR7fhFu_lspfLGim4dNfTiSwfEiHzrz5zoNfng=" },
  { portal: "Ashby — Senior Frontend", company: "Assured", title: "Staff Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQErlpNjVL2dTh1rxUgpr6lkQZg_MyhUFzlxGJ4vrMBTzM5iimcefcW5_KRbPKTCLJhFQRP0o31qQCYiZu_XayKudYhxcZn16WTinuhm6FifR4TJZsm0oXtjtoQ3s2qSxG6Ga1GXPR_EWYY_-gRCMcG2Lqh9X-XOsheJ294=" },
  { portal: "Ashby — Senior Frontend", company: "Sound.xyz", title: "Staff Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHrcaB7qEYLyhacICjYzGazsmaDqSI0sKZVx7YrfN0aw4_zBJHMbwx_PtLFYBzHOnnjgz3F1faH3k0c9Dw7XYodZ1vC9PGmHdjIlEbkhV3LeyveaPi4UJWyjpG1y7JLH-7ZTdt0ohIKkKHmOu0ssGVCy5hoLZ3R8Lp8U0wCIg==" },
  { portal: "Ashby — Senior Frontend", company: "Cogent Security", title: "Staff Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHSHO6pRtVy7IaPpMsDeFqYCpJ4Tudg5trVHMSJrmWFBMdwTAQUyLzwy6PCROuFXwUposyCMtGzrdfvpIiA6Of2IYOtwwSCmgzPJEn_IXfoFFScZgyCa0oOUCRalc0dPcVvIhpqU2mxtQS6j5LZCMmfq9-jbPKg33SjqscabrcliNvMDg==" },
  { portal: "Ashby — Senior Frontend", company: "Pleo", title: "Staff Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFZdEEt0cx4C3oAuH_4lVOcqKH6FTmIcJ-fsQF6VfK755TxvmoqSeHVx1Jovr-9rau6-1WxfOUYp-1imKpo3Z8fEHFVRbl0aaVkUIxTqJd5FXfyqcKeKnDAXqF9466iw2T8xPeXL1QLzKR7XlNgg8I5z8EkQQd3eYQ=" },

  // Query 2
  { portal: "Ashby — Senior Full-Stack", company: "GridUnity", title: "Senior Full Stack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGvPy94EFRlAI8JhMmoRG7T4dXJbsskO4ALVGpXtAfE28IPjN_iOeyBBSSnnvlmWgGZiJaYXPx-oC5LyXveA4ASCAdfp3yxSqd2uhfs4IuYouHxk3UOBFi94Wtl2LpB_VYj6L0M3PHSMs6D6Xm6WShpezzFOBs6-hDqP0lIRA==" },
  { portal: "Ashby — Senior Full-Stack", company: "Natter", title: "Senior Fullstack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEIXvnsi0Q10zpTcIC1EtpveBkpi7Q0fG5tFVBvrHsJCmo8JuzBxt6ie3H4MSwVPnYiOCUWzpUp5KhW9MgONb7Er9cJmbBoRHoem7KPzYa6hkk2Dl-fKbuKcc-y61IMg9S_BZtL4Ag0rwGhSd4y14lCf7Vi_OHiMP_Hhw==" },
  { portal: "Ashby — Senior Full-Stack", company: "Pragmatike", title: "Senior Fullstack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE5tvQcDUMBLxb827UxBV5ellzu-4m0UWdRQYiKWSSF7Yl1JTjGFVOaNedHNot9T4u5-nj3QtkOTZwM3ngzWEB5tedZHfOohYWErnfWyiKWqObdNxs64gXmuxTuPIOmtKs0bVBnBIlTCgA_tMahgUSMySvwLa7Gfq6vp_oNCro=" },
  { portal: "Ashby — Senior Full-Stack", company: "Zencastr", title: "Senior Fullstack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEqh7dCjcc3zdJMoM4xL43sxoWfIFCCBw4yfa229sDeUM5gG-0oQdJ3mAOjs2WMXV5LroH23aX-PvkToSK2w0reQwpszLxKkk16uaIafMb6ha3icZNGWO3KaEBPGiW_Tevp9-tu_4Tsh_A4aiqajt5xjiV6Af1B5p3V0TBu" },
  { portal: "Ashby — Senior Full-Stack", company: "HTTPie", title: "Senior Fullstack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEuGtO7btM_5n_1AlcQKFtXgT9zf1s-JIDJ-59SGQ914p5mvBCxjCK-YA38L2ukuLGblXnOTFFF0R68q_ZvY_7dVZ-iMN2SkCTxpzg7NnvLkA6kVD8oaM7rmKgRBp6i6ThN7AI4T0IqoVwudZy6yErB9CIDCPKKhA5ncA==" },
  { portal: "Ashby — Senior Full-Stack", company: "Clarium", title: "Senior Fullstack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHlUW6xShCfbxoWjpYwVmo0zOW8nzLrCIWNJz0oQRbA0bLY-zy90gsIfI68RNVGYJGIibwpfwUeQ7L1cGichv_WVmqqPirzLs4i1gSbOAsbCOH1cNs4LxQoFhmWWNgA1b0qDSOibAkgFP_r1Pyts04MDF2--GCw4AREizA=" },
  { portal: "Ashby — Senior Full-Stack", company: "RxVantage", title: "Senior Full Stack Engineer - Team Lead", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFjGUoX3f3uwplfDpBBb2z5OPwYUlvJzEgTYzQajM_lK79rW06caX83pEw_9wqi8ws9FA5KJiYsE1s6FFmlAmw6r-xMdHkHVvAl_UFZUNCe82Ih4NRc1gw_sOdMiyXoa5LyqbBJrpMz0EpfQkv2gEDeX-vtsoih7B8z8lm--w==" },
  { portal: "Ashby — Senior Full-Stack", company: "Tolken", title: "Senior Full Stack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHoaJGpd_7gC1McbuLkhMpfY1SkQ7gJawA_9MPOT4xQpnEm4BiVdKVdRDyi7Xi_posGwKyY8WHQOdZr8FIXzeB-XCktaWTpCIiWpnpOACJHBt252PctFgXGvK2vBoAVUtyVtK5m1K69B-CX_5PGXbkLzOjuLXBwwmY1rw==" },
  { portal: "Ashby — Senior Full-Stack", company: "Commure Pro", title: "Senior Fullstack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFiEy7FOECjnUj1KvXfvXZ3MzIMNhH7xZMVyRtluqN_tQro6t-nzj7oEPuvS06vyS2sQnA5paQ7_W_4mlTT9UKQqaISm1oGrlKd1_xGZ4lzZMuhFsflfMNM3o7hOKTppPSWLRdQnxs8WXyq1ND607XLyA3hJtAXDRdGpWI=" },

  // Query 3
  { portal: "Ashby — Product Engineer", company: "Playbook", title: "Senior Product Engineer (TypeScript)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGVQiDNyUrJR8j-lZndfsWRWLwSTC6t0-vMoGKMXf1HCyR_fGq3K5NkgWfb-i-rv_15_7mjl-QlpuCxP3rcopxdyrXSJGSvFKh6bOGUd8bKtBkZPXSDF3BD8veM3UEZmvzhgq3PFtIMVt5yjpu45dTposTyl4DKsSzdHvc4yS8C6i02pGd_7gxYzKIvPXxy75XIRhc=" },
  { portal: "Ashby — Product Engineer", company: "Maze", title: "Senior Full Stack Product Engineer (TypeScript)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHqGyDIB2mF_Oz7iGQidsbJknq9ZtKG1oZDWtkaYzg6HADy1jXo-pvi-iRtwzzm_0Pa_8NQjxRJ0-q_Oki-boKLKRkwRp9Uq4SnPh5wWwRJaU5p4E4juofmT_UNWEP2n4vWrg4HPXTwFUZX_EoF1FD97Kd0VQBYouDvWOqezj4=" },
  { portal: "Ashby — Product Engineer", company: "cfo.ai", title: "Senior/Staff Product Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG-0FbwIWMsHg6aMSw53T5fHI2cZlOmmDOyq7_GDiraPpcnow5fhCasTV4JzR5Ybk6u3cDuj-S58tF7KrE2OE-Vap9ROH6mFA45kXVeV2j4ZOpbue02yAj4kgqP80QmvYPB0wVJWccRHd8FwSSKebGgYlb9_CKzTU7VEg==" },
  { portal: "Ashby — Product Engineer", company: "Polar", title: "Senior Product Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHqTgdgUY8g_1JDWR9B1zPx0Qq9zgL5sxRmnhtw1pE5rW2sB0jz7ke4v3LuyLT6tp5sPHJSLSYt86426mNtJliPEBhyd9JsGl-LAYSgy_gSl_69FTqBDGrgZwe-M6z3QegPkfLsiw-pTl19Zgs3Z2ErZ5-B5K6xl77e" },
  { portal: "Ashby — Product Engineer", company: "Vic.ai", title: "Senior Product Engineer, Treasury (Elixir)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEVo803VKOqeM7GdccTWf0ZtGWfpzsY9H3VMjGRv58vP5otEmYeYP5Ng5dcEw47FacoiN77xt7adExqMgg8f6db15iR4kINt-6aBfKKZaUWrC5quuVgyDP6cVVmqibWFgOA1hp0puPJ67x2qQDSf10uZKdfEq_1baTG_QADDCCCmC4UWQ==" },
  { portal: "Ashby — Product Engineer", company: "LiveKit", title: "Senior Product Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGvepSy4ogi4BN29lV_NfW_3aN2ga0WGh01vOMcjs9nDBXo1OkcCT7FRhxgK2Wvg9TQvbu67G-d8NDOz2nuI58WL-hMjt0rIrhyp55XcSg8CqB0BBEplGNxdz0f5e97ErR4I1yZSJLVNOc4p2oufcH-e2fAKE-Z3bshzSc=" },
  { portal: "Ashby — Product Engineer", company: "9amHealth", title: "Senior Product Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFc7ZLI_BO6YuNox-kvDKLkac0gbBCdUO0wyyRLyyMKmptZTjhdj7_btlER4BJS4WOAcdyYWqjdadnZHOAdo_1CBMnc9KmNAuToRB-dFAuum-2Q8zab5Lsc0-gf2vW_f06UOeJBCqbOhLQbUtIfWKWIb7r6lqdapcCpP2w=" },

  // Query 4
  { portal: "Greenhouse — Senior Frontend", company: "Airbnb", title: "Senior Frontend Engineer, Agent Core Products", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGGQ8C3xptdds9HXuQ5vgCIu9e8hr26ROp36x3rBAIwD2oG-_B1Wcdsbp0W-PbPdPqi-iAFm6_NqDr4yGxwgQwkE9Emxhj9pYDpiIFiLWYBJ6iSw22LPWkWN6bMm0G6KGEYo8P2pYFPkK65" },
  { portal: "Greenhouse — Senior Frontend", company: "Cloudbeds", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFVkbD__hH5AC4Bj5egOkmwdmDg7AWIeBgND8JbkJA6sEo_6E1JCnv98MKbLaLTrkDRPEI3tAEemJr5y7Mqk-REujgiWTpg9QzGbyruzKcq4rG4OLSKRNwZ1X2iW4a9zHDRyLiK7HnTesdMIEexoLL6" },
  { portal: "Greenhouse — Senior Frontend", company: "Eltropy", title: "Senior Frontend Engineer, Fintech SaaS", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF0ixE8825bea_7_GTjTgwyKaON2S9N6DiZY7NUHASa4OMY_QnvQLBac-QzAzuefYpUOLOC-EIftdqtuVF4GNlSz5dv6_u6ZaECCPrLDQBE_cfeV7CxyDQaJot3ZZsJIHTjylx02wo_NzNO-R3klLLi8A==" },
  { portal: "Greenhouse — Senior Frontend", company: "Roofr", title: "Senior Frontend Engineer - Contract", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE722hpAp_ZDFSfQULZhejBOc4yxQKpvhL8IbFzgZJyo4UsktC9aHUhL-Z8QyV_7xZZMk66cwKNQQxp-Hty9ERbUfOQadJ6GJuStn0KPjS_eWKV27782wk2BpFK07GkkD-etPjgxq3KVZbZmK0=" },
  { portal: "Greenhouse — Senior Frontend", company: "Engine", title: "Senior Frontend Engineer - Fintech, Card", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGMg-Npx8y3OhXASwmlvmUwbHmQoJyQ_E1TyCut9jNS8IDT_HXrm9w6jU0JjCs3bSt1YDFzJPmtggqX9mrosa5eqVsUI6sKY5jVJX3-rpU2-r3QGHJTCDvMxkJT3SFQSJ_HNNmA0XJQc0Us_zHd" },
  { portal: "Greenhouse — Senior Frontend", company: "N-iX", title: "Senior Frontend Engineer (React)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQElQn5LaO5zmTx5alrGp14KMa4fi4yg7NQHkjNH1oNERKPLSaEZEW2NMAC7fPr5CQvE8HUh_mF75Ye619Nl8Qmf958Uu_Tf-08TATSpTay09_-YYTdwxEz-QNYYsjoUPCwfMYlHmtV2Zv62" },
  { portal: "Greenhouse — Senior Frontend", company: "Lumimeds", title: "Senior Frontend Engineer (Next.js & React)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH73r4MeOrPoFfG_yaP4i4AHDjNbbSZmhvt0zW_Docxla1iZopqNo9mb4q5EYgOptmmze-VRFfO3SnwVlvP8J9XT370ObGF-0Ag8oeWY8r03lsQ8zZGNpVNEfokRvQxaoMWVZ2iAR3EoHNEM0B2UpI=" },
  { portal: "Greenhouse — Senior Frontend", company: "CodeRoad", title: "Senior Frontend Engineer (React Focused)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGZULWV60FqX7wOxT7fWrrcnUExvWr_vKY3m3AHFtW8XXbdUpwGdl-rdmODhni8UH3peWsaqGWkZ0l_XGrgK5JkJu5K5IuMAfEqrPgVDig2Uku5sYGEbc1nfqYRRVPs6QNfrQ0U_gbC_VXWBOjogGM=" },
  { portal: "Greenhouse — Senior Frontend", company: "Future", title: "Staff Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEsqWsVyuVe7do2QuTUfDpVK0HOr1T9QWaU8M7LyUfCAbMB6z6_t4kkkpCyH5hXLd8qmHHf7866FIvihkRzvrGwo92DBiYJUN3YAQEYyhE1PZRI0Q2lPVJRmX4LLPShLUS9jZggOrhiK3P2n9w9" },
  { portal: "Greenhouse — Senior Frontend", company: "Reddit", title: "Staff Frontend Engineer, Ads Creative", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHfJIlWHh8FK8_OpzSFEtdZF_FNTIihgUoihOJlw4zJv3fcC5RQUkAB2vgT3Hv3pa0-wQ43iH0Hcb6Gz_c5v5VQ19e_4KPtWO6ay-jE7vF1IKpSWvEq0vm--05U-vn3iG1Aua7pxZ-jrIBQ" },
  { portal: "Greenhouse — Senior Frontend", company: "Genius AI", title: "Staff Software Engineer, Frontend", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHmQDXsbLxKx7kB2UAHd3i0NcHJTMitgbAszTV0iSdZAPdL1P3fmi8hOyBcxl00OgbzeXEEQcPKiuwzd-JK0Nltbj0up3fjbbOlnJYWCWX8eeo81FozZPn-TnjCVDizyrlLikJmlgoC4wwgSi3ZRM-wstg=" },
  { portal: "Greenhouse — Senior Frontend", company: "Modern Health", title: "Staff Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEh_1h1ctgYLTi44txHjhhwmZrZVG_U7l_x3FANMitJwxcuxPG13eFwNsFpeh1BSo0eAv8MdP5f5F_VvQ-sVizXyiyxwP3Ebr6_losFI6wymh3GrLgfBHH902qniYyMZihdsh-tfF5Z-qbxfEPC-xM-Fn8Q" },
  { portal: "Greenhouse — Senior Frontend", company: "Machinify", title: "Sr/Staff Frontend Engineer | Web Products", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGAwD7Fpwdj-y6Hn5igXsXsn3EHdXavI_3MQZ5Hc7afUuGkhlom-AAY5SIw-b3FB6N82N7ouFtagIdwuY-XL1LRqhwno7_2u6uD1hDuzkfF_ejj0MtXkmq8drMj63J4RNAi9dlTwJMJdih6CZaWsEZ08K1c" },
  { portal: "Greenhouse — Senior Frontend", company: "Breeze", title: "Staff Frontend Software Engineer - Payments and Checkout", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGepjPclf4ZH-MRJ28LcKMYpk6yt1hR-zk3VMP7teuX-Bj_zam6K97f0JnxbAG8tW_mDzWsxIgmQxCdy6Dx4l8EmGDenruXxFzoLojwkkI0AkXIKuGrzK-3N0zqCEjCTlVTcgUthNdOvkMiLMFZEnGEtw==" },

  // Query 5
  { portal: "Greenhouse — Senior Full-Stack", company: "Fueled", title: "Senior Full Stack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE--f6d982SozflvZMQJVjnxPe37A6vyqUlDdMAnO-e4M1SK1Tcs9qgv9jwc2M6I30_nTTm8jog65RaY1afDX_bAwYmqsZ52qfoJQ9UsKwAdtAe67PH41LH8mv7-H0p6JMM5kcmKyvO1qC3ybDVY-pNKpjJiw==" },
  { portal: "Greenhouse — Senior Full-Stack", company: "Serhant", title: "Senior Full Stack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGHjrtKllC6KlqqSrmWa5FwRZFolc6M1i79WRuzBYXp9uN9Zx99T6jDna4IscBFGaGzKvTHGaT3ZTn9JgaMVDEgJ7eTYhwZxLabtZTITfkREvpcx1Jwj1CAW9RrnrEyHs7beim-IjdimBNHxmI_vA==" },
  { portal: "Greenhouse — Senior Full-Stack", company: "Reddit", title: "Senior Software Engineer - Full Stack Internal Tooling", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG3q6zW4oKxnUaj1zSEA3ZzlbnE86b-GtOSignWGBj3CTyEDw_hMjJ8lAN4tL_eGbQRM1dmALAGpPn_XI1r0UO966okNwa34uQtL3EFDrtzqS7t40r1tzZJqvLYmoupgGqtKGW3rv6I6Nk1" },
  { portal: "Greenhouse — Senior Full-Stack", company: "Underdog", title: "Senior Software Engineer - React Native", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF3UtWOwxbYEt8oqC1unufH0Kom5l1R2t-20QQRKAvYBkNRZ1yRRf_1ZULz6PL-2ANHzjGjqwDW-5k2mnsg-f4zm4lR0yL9QRk1-rBsdm9gkHAHK-nXPh1uZndoejOJwGh_8Yvrkc32HWBuwyAqrt60R0jFXmRp" },
  { portal: "Greenhouse — Senior Full-Stack", company: "saas.group", title: "Senior Software Engineer (Node & React)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGmfOLUe5pCGnWi4o-rgGtKfb5kyOBuRZYjXhOTVOxg3K72ufE49MGnAsNmGyfI4xtwhc_aQ6VvnUcsf_h45SjeX1aDizhKXs6kFL_d71C1RIps0B8rzNoymXjXmlrdB7gH63Thexq98zHjTNdXGZ0g" },
  { portal: "Greenhouse — Senior Full-Stack", company: "CookUnity", title: "Senior Full Stack Engineer, Supply Tech", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH45gZoAqF9rFohIymc5QqxheU4vHjRv3WvZj7HyYwkRQIrQUPeVftPvEUzQ8WHnSAZ7VIv4mkQlrXa0QK32j-Th3hCR_0tAxdSkB8oY1TdbAJpHPSBmDuCm5wU5jJtFlFDtPk95tQGsapcSZ-cYaqs" },
  { portal: "Greenhouse — Senior Full-Stack", company: "ClickHouse", title: "Senior Full Stack Engineer - ClickStack", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEunpOp3SL1YCPD0ujEdedEctuhJqfcVIj0OiCFor3KOsK0T0dJKI2UlUq8nfVSRWtSWjDa3xEM_A0KY5iCXerhkZONWEeEPOJVCvQmwNpY756o3FrP2jWAYH5801lXFuIJROePHORcsGRlEk7BCIJRbw==" },
  { portal: "Greenhouse — Senior Full-Stack", company: "Nearform", title: "Senior Software Engineer - React", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEj9PmDdboXsLAjslcj6hUtyQqqcHYB9ReTJ08Ri07uXoB6FrD5EV5ceyGcUYn3479i_MRKnrnIkDIYT2tp7XWPpMecxVEJtCp3WzB8gBAvCN9L8ZEEeP0bTs9B2XH7KEMB67z4yz875lzlGgEEeG8=" },
  { portal: "Greenhouse — Senior Full-Stack", company: "Samsara", title: "Senior Software Engineer - Connected Workflows", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE9Nb5S7qnsIldV8zlaeYADQ2heQZiWx7YIktn4zqD6ihGIHxeiokGeyRMWntzk2nCSiEisw3jOzu4ZIZx08JDzQvZCM7lZGNKDmrTLjwa1aSaznBOTdIEbRCbSifpTDCvYhowVpnywwCJraw==" },

  // Query 6
  { portal: "Lever — Senior Frontend / Full-Stack", company: "CoinsPaid", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGXcYn8BzXK6B4qTcMYTuNuoVb608ujCnLwbSXe3a4usZFaC6syqymwFcegjxFGn7PCj81UEhQLmlPHHE9CZEYyp-vdsplDBdKIN3ieTyQHy7oY6xHzOvITx0uMantXdhFSY0wF0SCartC3lZkzR11UGMk-BtAN3quqjfREXw==" },
  { portal: "Lever — Senior Frontend / Full-Stack", company: "AICrete", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHiNXV6bI_rl6TgKdNQEPq0DYRo0wTJL-n3XCRTUpy2Dwb31qhekHHP-gOFa6kehhxaX3HMolCk19U6JmkZ9krCefGjIb9Qcve6n9Z2tVuByZXASSZ1mTIisge6FMI7Qdyu1zG-teQz5V4O" },
  { portal: "Lever — Senior Frontend / Full-Stack", company: "Partyhat", title: "Senior Frontend Engineer (Bulgaria)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF1XG9XOnmnpISO7zUp2nljP5f55io1fvNeew8X5jo02UeTkWVgKq7bS7ugBndSK4oKfG4zcP8LYXTAjLC9KLuUkJkkbfTSSpdGks8L_54SA_TiVxPxOAcOKuTl-61gB-R7DBoc" },
  { portal: "Lever — Senior Frontend / Full-Stack", company: "Pigment", title: "Senior Frontend Engineer (UK)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGDOcdmVgaqPTomesig7W-UP1x05fz25tNw4cMvkIlP9DmtbQB7ATf5oJDMHvYal6b6156tgVjQcO0zvm98_LUUTjUm567G_fIrTlpvFu8CNIuuQEzvwSL4duSYqMDBIwR2SQbjUSCi5A2izCzHLY6Wzg==" },

  // Query 7
  { portal: "Workable — Senior Frontend / Full-Stack", company: "Treatwell", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGZyOVgBPzp9ltnd2yXvZZtBAaPVxEi8sTBWRGINBi9aW_b6w6GwR_T9dBYfuppZ3TB1kpPgxDmmnMn_XQSvKvPYvAuGxStahAZbl1w0QPBbFTHTUhO_m-0mthwRxN4JefQv7Mk1GG1" },
  { portal: "Workable — Senior Frontend / Full-Stack", company: "Soda Data", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGT48IL-vIiifble-ltLeE_zSpjbsSdRGXVuwDLIZNTdurrsmu2FowhOdQy48Lp6wdZuFz7s59WupWhCZhV5jFpb5ZQObvvL64FTRPeMQddrQHBZ4-kf02J7cOcxOnuWucmVlwEiPL1IKdfTg" },
  { portal: "Workable — Senior Frontend / Full-Stack", company: "AOA", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE1u6iycmgVHqitZmlh1zqZBzuCVnYiLXZdo2QqUmCffjFQLXVgm0gMPtHGkidFY1eVP82_jtCl37x6nXbiud5vWRaq0qNOCZ5juUBbgHmjUiLMxoj_CScjBJmevlFBYJ9Klpr0RWd5" },
  { portal: "Workable — Senior Frontend / Full-Stack", company: "Fuku", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEcTE7pRzEQWKRnZIVnQAhGwn4j8D4NaqUBFJgvM0S-veXoeYCXS7koo1N2tcOw_6sdduCMK5i4SP_UksKqsC0zSZ8IsHRI3OSyQKn7xyERT4J_-xac8pCSVH3G1i6LwOEBsFQ" },
  { portal: "Workable — Senior Frontend / Full-Stack", company: "Simple Machines", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHxjweUtpYT5RUI0qADCNygXh2tdWCqWI_k0uAqZpqq2TiJD6G-qFfz26-7ACgjz3G-GXwv3oC0IFHc6fl4DT2Twcwddc7v1hr7hCbtxQeCxaowysunUOV-Pf-jqBP9lSwGnNErQ5JV5Wt-Yq-493Qr" },
  { portal: "Workable — Senior Frontend / Full-Stack", company: "Pack.com", title: "Senior Frontend Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHGEmR1_LXKtafMAj4rYK9mIwuXeuQsdBopwZVQbRcw2tgQHPuVZ4ALGBdsmxJuJbczy0J0L5EszxNZy8v9muDMIbtb-v6FIDC8kf-tqPfYa0fWXTKXMjBXCkN6T-zgwPosOBo1uMN0L0ExD9CfiwpXU_4KKlE" },
  { portal: "Workable — Senior Frontend / Full-Stack", company: "Pickle", title: "Senior Full Stack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEe2ZsXbkupX65_lGLTCT5qtwnlDEuu8sOweVEvoW7fL6kLvSmu0Ep-_IrFYiNiDep3_kV1JCUKaxBlAwXCkreli0P4UOMtpkqAfd6O4DEvfgvH80EHylh3DAGYmUXlABwE0we3BMFR8A" },
  { portal: "Workable — Senior Frontend / Full-Stack", company: "MLabs", title: "Senior Full Stack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGx2jsjRU90AgLZPPrUkQ96WVvLIaQxEAr-1mg041YwQdYcbUi0g_m89pGEImFiIvmjshwXihmoE2UuYPLk2NzEh2nlM3tfd2AsqwqSZb1fMz-Wms1C9jJE4MKG8yuDS-tkdnfz" },
  { portal: "Workable — Senior Frontend / Full-Stack", company: "talentpluto", title: "Senior Full Stack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE-0lpK2pzcdpoyEIHDsR5xotSB4UqIAQ30O6vV_S157M9Bspb-uqRiO1zf7mRJL0u3v-bl6R8RdYpYl0vcvgtjUrBEwrYJCT3NmtdrAJg8Ys39WtFxdm5kFjuKpAeHL1h71cTo-wm6IPk" },
  { portal: "Workable — Senior Frontend / Full-Stack", company: "Pavago", title: "Senior Full Stack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEWvQKNx8yyqHG9ik6SPlMjmOWkbPRep0XdPkpniCXgPHrR3X3EEoguE5LS_NZgTKC9f0B0yVPNo-XEazm-gMHHj9oTCwWgsgZbyX3mb7Am3itVbdvMApJKE5b16lTcdrLawZWV" },
  { portal: "Workable — Senior Frontend / Full-Stack", company: "Space Inch", title: "Senior Full Stack Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHAzXm2erWKU4ZmXFktBwMfUdltsAh8ExeC4UqZOU-R7sCwZCVuUU4ls3SIAq68sCYUJSqy-3N0L7pg1DGzyFvZhi_-Ple9nf14jyGsPbLvgVPjtzkjV499z3wLWJjlGIKjyIR4Q4gc-w" },

  // Query 8
  { portal: "Greenhouse — Product Engineer", company: "TechnologyAdvice", title: "Senior Product Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFNnhnlMo_eeSFILUjHMCh0ilqPifj_35JLcjl9NsL--MLhvxDgrcuqyDsPOe2ygwzAoCag--lSZZi2igam4KWRxhX4TdHwQk1Cfsou0kTRC4PgD4DnG8MevyXtZ6MjJR923Jawz7PHDM50p68mUph8o9EOP4Ze" },
  { portal: "Greenhouse — Product Engineer", company: "Arize AI", title: "Senior AI Product Engineer, Backend", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEV3NiunubjXsNGs7tc_vfPrMSwt3z5uyRTdOOeN_lRLfV6e_UdaS8wCUCgamDvyXSsni3lpY7K506ReIk7hGZiaJ33Fq26HSe6hnxgx3kjGIuOYlqW4iFnmB8nPpp5FfHWnKVhKn_ONZaidomJ" },
  { portal: "Greenhouse — Product Engineer", company: "LearnLux", title: "Senior Full Stack Product Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFOBbXF2gP7_0M0l0o1OvdKWuTgfbQyfEQ5ta-SAqZ2sqaP610Xs-2RYpdkSLFUK6SjhcGZkcaM2Eo2ZnzM8_OnS-2_BuzWaXueAOjCRt3OphNz3L24d14n4T6erh4M0bLEfyKkC2-0SIpK-OcLaQ==" },
  { portal: "Greenhouse — Product Engineer", company: "Clear Street", title: "Senior / Staff Full-Stack Product Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEJCBa8uWn4xGxaBB56_vbB3ccrOduDj9zVh7rHd5b8x9oHic0uw6jyyfoJoaXkJclF3QM_kw4Hu0zyB8P7XWnh5rVIAXJcfRO1r7AQCoCqNNueJdYj-MsaoLdmj1pNZyNIcgxZBIyhZnrv_4FwBw==" },
  { portal: "Greenhouse — Product Engineer", company: "Esri", title: "Sr. Product Engineer – Web Services", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHfjwDRx0VVrG3IR-M2yJ-f_8JeWNDf2yMNxXp0ZnNm5Ml7gK5EXArxrZz1BDMy3srwSmHmotirJImL-PtTEt-0f6y7toGcF_7yKOrwgueJHLt9STzhJG44zRmUYxgtvdGoqsTu72clcaIe" },
  { portal: "Greenhouse — Product Engineer", company: "Cresta Labs", title: "Senior Product Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHAWIbbviv-Z7SDB9kGRqMI-qfeWCJw3uF-UBBKbbBk4idVLe3ZLZq9EhPLJKeus_nvIbfheFMjxMWlEkroVobCI9p1EARlBnCVhX56k4KEsnE9z11fgh2wAuSa6q4yWrheBvbz3s72VNE_FDE=" },

  // Query 9
  { portal: "Lever — Product Engineer", company: "TradeLink", title: "Senior Product Engineer (all genders)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEfCdMTG7eVj0RZRjbsr1KT-JOX1oMkkFJyvUPkvYTSF8yEYnqr0VxzF0NEidZZ6k6apBRRKgF8_0daW37_AO5IliyLU68YpZO2g8p8kaQ8f3SBamHhsLiw9GNVCuLtyIXN021y6w4sYvpSL8bqyVN2wAZPq4tcZNc=" },

  // Query 10
  { portal: "Ashby — Systems / Platform Engineer", company: "STN Inc", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF979XPHgZ8rSsR1MgdXoVUxDzu-r450sZvfvvHATg2KkcAOyL2mitRrfcHH6LSHLCABgb6a5kcYQi-0QPDkkDpaZU2RlxS7uFHMhfGO5bQop3sz6IXComraObmX5WHzDsicmD5rO4hU_Tkte1y5NW4ON6jbl4JD6nf" },
  { portal: "Ashby — Systems / Platform Engineer", company: "Rifa AI", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFHlJ4oRj6cSlUNolw_XO8mbhOLT514IM06kShsO5AOf9u5FmOA3g3w1cZInMwVV5BCt-b06k4_ZC4xN4hijU-s_HIll_XeHg65suNt2qFZ1APZKnh8jBdQLtB-0OJmbVVaEXoYHwtAbty-Zkj7fH9jnWoJc19JnA==" },
  { portal: "Ashby — Systems / Platform Engineer", company: "Mux", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHwWRyaYElRH8fianiCBdQ_Nhp3L9M514CavFR8ymunFdZ6cVN_ZRzOn22z6CSsbOpiaiTPAjXIFdOO457tBSKHQhaxNOXSz3R58jwyd_IvKD2X_ywTiP68Y4dpY5xFS2-9F3XJmMHo6AFYwS-bGEfQdEs10tJL" },
  { portal: "Ashby — Systems / Platform Engineer", company: "Bestow", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGaOb8zbIY0TaQEm2mBRlPTwEfqgCijRMS3odF7SXe7TtT5IO74GSUntRy6m--W1z7MzJdP2wt87yZ_mr1cSzV5xzcMXVdS4N49TkOCdi1SDRy8BcBlTbhVMu1qfesR5Zlez_jo-i-QL9d4ZMrtsswo6oKbiGQUYk7E" },
  { portal: "Ashby — Systems / Platform Engineer", company: "Tiger Data", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHZchkS-LJ3IO6WyyScLB0LC5qv2eOybf05f5Zf6uO06iAFKnCn3G3SZGXy1fHZaIQGva4VnnUW-QvtPYfJdMt_1c7eY1xmRnaEmf8hNsDUK2_bA4Hc2bWl5xkvqWyofNPPz2R_xUK5wlugWrCNMUU3YZsXwjU1UIrp6YI5" },
  { portal: "Ashby — Systems / Platform Engineer", company: "GoodShip", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHGNTCv8E8-gSGLqcabydSlXdlinGDBuymSfGp2B6-afxjGZ0P8pxZznKgxxN6uyoZ8fCw00OSWeUzcDt33z57DBGDzCLrPhpsMquY7kI4k7CiyuzUT2Wdd1JG4F3v9TeSJLq0qW9MbpB2Hlf2tIdrVgT0Dua8X37h4Ja8=" },
  { portal: "Ashby — Systems / Platform Engineer", company: "ReflexAI", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEhcfPcsAkgh8UYUb9ff2kBNCnEB3YnNRFzqgr8CXjXaDtkQYmoC3pQG4tKWKy7AnbeOYXwbvKU74Q4sPsYCAveqBlsJrgeoceEd3BdcjMsWZb4XQfoislKroYcAmPnlhOH4hsbCx4rEuChTmdmxNMlI48AHbIZfeIofBU=" },
  { portal: "Ashby — Systems / Platform Engineer", company: "Scalar", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEAqHNWUJhB7CEMSd5_-kok_p5ZPu_dtfHb5GsVkFytMIh1mCRUkWBKNfhK8TuI78w292sJz3VQphEWVyEK0RSHZXUhn0gJuaAFcRLz_-rAzJ3wKnIgDEP25_dL5-QU5YTyhnc7xg5CG4BQVtK3kp3HJYMu9AZg8Y6E" },
  { portal: "Ashby — Systems / Platform Engineer", company: "Midnite", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF2vg6xdkO7iuoO-6hhnx37JRXBPee9_Am75cPYOQKMmFK_MmRuYnme93R23JDD3dZjryzJyTKDF9zkp1294DnjT6G-k-R-kIymIJSruLhsQwn7FCMXqopzeP73C-S0xJFHz-Dv2LF6DG82EBgROm4g3U-LltsWN3yAdw==" },
  { portal: "Ashby — Systems / Platform Engineer", company: "AeroVect", title: "Senior Systems Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFr44smW5otuAT-K2bl797hsynYWPXvbrVjWRDKGwe8k8-SmOjk1d0ADNnvPPhvAGzz-akYxfDmLU8ztfTbUBrHGoymAVGbtzj2ya4M768e6JZfKYiC_01Z8wjISoKDyc4ZJ9LGPyeveXld9xo569vqO6zu4cRHWWpaXbkm" },
  { portal: "Ashby — Systems / Platform Engineer", company: "Umbrel", title: "Senior Systems Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH9yxzukEg22NIbSJgDbqyJYxG1YJmLi18ExDJdKnzi1SU-1dz_IoNz04ISGlqsCS9k1MrPqWLVtWOX2HXLif4FfWY9m7zUoFawHFNVU49A44qcbr3fT2WkSvMprKAiHDOLBrvBBo8szEqSU1syYCdVZrxvWvuYCPl-sQ==" },
  { portal: "Ashby — Systems / Platform Engineer", company: "van den Boom & Associates", title: "Senior Systems Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGhonIYapv0mbpPDUCXh7iiByvqDTYcHoWjFTBnhprcOpC9l2ZgyfN7-6_Lc1GCJWxKmPB2dfvYcz-jxoW9DBAwftPuH2voqbEFoMaq72qR2GWwO980Wnjw-FsSgghENN2E0zVv_tEsMQns-mO8pi3oUheKDop6gDuLX81foeqh36OQQunW67tp" },
  { portal: "Ashby — Systems / Platform Engineer", company: "Qumulo", title: "Senior Systems Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGDoih_LN2zdoFRuuq851wuCn2HDTago5_gImcUK2WYFI8Hj3Q7oAtQRtD-zDdAJyR4YeURyOCMWBJFDeD3XkZg3IPfcwGeZ9IMvmXEVWOcZEJnyws3DJ53FyiUb4cHROa-SKsAX2z3IgNwPU4HW2eL7a-2AWUGdcpoQQ==" },
  { portal: "Ashby — Systems / Platform Engineer", company: "OpenSea", title: "Staff Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHjjg8RvZFEVkKeabu4yNXnfLM2jjThSKXySoWmxU2X-GnLivhFdkbkjz-ASs89k_bMI27MYjsYE7KdTHC0gLQBgHIRCERgnewckxhs0j0ZasWKG12hbRJS2gJOA21-rScb70w3-cU62E2AHFUyi-xMA5ApN-xmxGaQphE=" },
  { portal: "Ashby — Systems / Platform Engineer", company: "Citizen Health", title: "Staff Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGeeEyT0ag6_rkFUzLw21PY00vPh38fvvOvCU54EjMIuBFbA4nTgstvnoHPXzFkuEmMHrVxMAEosNxxPfn1C8NMdAs2yl7eVcFBoxcLoNRDb8LyO3-Mp-5ZXVBv_4ReefYCscKiXYS8zW1Akp3I4DCFQAhiik-sdhAdnFz1dljUOlN2fJ8=" },
  { portal: "Ashby — Systems / Platform Engineer", company: "Acquird.io", title: "Staff Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGuMoFJ8XngfFPApF-hW6TFbA7MQIERY0MBWCitjHdnOOM7yWPooaEQ8FlqIZd_bwkBtdStVwB-nW-w2jLGHUZwVmwIwcD21b2kkMqNYphTKMgD4FGkAuGWKobcmwU2w-_MmTlKriVwVG6qdQN1q3y7tiXE4xqKyfmSpck=" },
  { portal: "Ashby — Systems / Platform Engineer", company: "cfo.ai", title: "Staff Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG5jzTjkndPyV2iY9UlBnReP6RBLVEYvm_OofRJvuHtA-EVlSBDBQaK9ZuEY3_Bi8hUjRkq3Q1GW5xYWDSvjGcIOQLs4P2fhe71_KZTRlebSp5Zo02ZrzpYxAuRYq6luxiw-qvi59CQoDKdV0vptt6z67XgRtThUHNPkQ==" },
  { portal: "Ashby — Systems / Platform Engineer", company: "MeridianLink", title: "Staff Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH-MBU90cfGU-8OsGqLLuI3pWPQkoczqaNDoLN5AzQKlWMMOUS1ZuNFxnc15ko1Uae0_UlDYvZC5zoP1-y2ZT40aHOeWKus5pDmda8D-8wAWIdwWug43ZJNIaI4PP7fyMzSGevkAht7bO2GghKej6LpXzPIOfNlwbhUOVpRu_uHvRnbnXZ4Cn-c7Q==" },
  { portal: "Ashby — Systems / Platform Engineer", company: "Fieldguide", title: "Staff Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF5nJtJWbZbhvN5371zR1Ikarzw5z4QPRDwBSo9YZ98c8XulR38SthaGETNefsVDQF3okgxHl-zzOqvOofGOLDnxR_J4nTjazJW_adnliejNEAcQA5ENwyZaiijAvHc02X1MlXdo_9MrY4-Yy0oc38M4tVKQox9hxdx7tNq6SU=" },

  // Query 11
  { portal: "Greenhouse — Systems / Platform Engineer", company: "Cortex", title: "Staff Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGTHrxWcUEjtCoKLQMh9rmFNwjZo8D4MIBKwLwIdlmIctdA-KvcCGesbb0nM7Swujo7YbqT5uzky43HXbrCMqL6tLAy-t4A05KzmZl3-X_VWSnAPSt_AE7jntXeKZXLW3c4y_IUOMUvNispUB2D" },
  { portal: "Greenhouse — Systems / Platform Engineer", company: "Grafana Labs", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFj9EX_6O93_v09DhgRLVhI6CPp6LWERIaAFs2_x82NnPNZ5ae8TN2N_MzDy2t0OKTHCdQQltW6119jqd1EtYk9iB8fvbaE35pSeET9wJArY7psKU-0QRs5vtvGYhjsDasdkWHvggCz2-02kazM3g-EydQ=" },
  { portal: "Greenhouse — Systems / Platform Engineer", company: "Collibra", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEgaBGQh7SWp_kv3hxwc3zA6UXQWfsp2RCsx16wV1yJG7JvowQfNzd3iOxnAwgID4tXumZvOIfzBueFfpAIGMn4RQ7zckYPjlziqbeQtJ2K_EdR2zPE-Jx02tmGmQq2VoH1_U-gTZB27yOQ61g=" },
  { portal: "Greenhouse — Systems / Platform Engineer", company: "Fanatics Betting & Gaming", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGSBGvVDy0ACs6g1Vc_rfjJDXnbtNIvHyD8youhkUXBXS5cEnV6D0_vh81oeAqB7j8r4VV-OVLUrnX_6e4bRNaC8NJg1bEu6vZ-RXFxHBQjIcp6kWNl3wv_7bylYpp1gzpMzR63bQkX-oEVPUwsE-eVRyA=" },
  { portal: "Greenhouse — Systems / Platform Engineer", company: "Leap", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEFuJXlM9P6zX__Z5ybLxUOU0kwXEsPjvup4rDgkXSgfR7bPwJWhfMByeKLatCA1xsNuWeEdVZnD7paNlFTdmH241hPvzopS8syNbHtVcjd8k-uEo9SWCcY9wh8D04LaZfNhgdG1kOdpTKzFkLi" },
  { portal: "Greenhouse — Systems / Platform Engineer", company: "Twin Health", title: "Senior Platform Engineer, Productivity & Cloud", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEc97RV63eHW9cB9Vb2nLGU9uUrKk9WXj3f-Srr-F3F9KZM6REr4umQUxE5b2CeJXtlOezHjnn7Ol2fl9zIL4dMKqWd-Ne8yO7avlQIyfWBbCvRq4tpADgccmNp33U9V0v0opAfYXcL63hAWoknrNDbUg==" },
  { portal: "Greenhouse — Systems / Platform Engineer", company: "Flexential Corp.", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFAQ6x0DrWpV5uirhnVxerxSmSueBhX59x0j8s8msBP6sUKKQ-4D48tOt3WrUAHJOPoPVo7KY6X0RGwe0VB4tQO9ngGEZuGDsvvSjrVtyxr1MmF7iK4SoMyvQWHj_hBXFIbM1xojLe1-kM92CSdOrNRGQt8vVQ=" },
  { portal: "Greenhouse — Systems / Platform Engineer", company: "Strivacity", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGf36JDL97S2tHOhlOtiwz9EOLF3W15x3XQx3t-qasSmWzWlVp61y53e05I5Lwi4aOVocLyqIU7itsFak5h_CDFBNpPn7EMeIoL7K2THWphUs8MhQ-wgPLKBnZ8vgNQxjXj5h_TsCAnSQfMQhIheB1kbw==" },
  { portal: "Greenhouse — Systems / Platform Engineer", company: "EDO", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHchxZswYXnaM58TRmkRMF-zmQetI8d9_YMAqtC8_2SIOKrqA3xoL1c-nKtWnTUjO2I30zlh7vWdJWexqihrTi9a9KnPtzvbi2l7Y51mxzaEf0GKORH_rKVyr56JSyBmGn10npNMguSaqD8" },

  // Query 12
  { portal: "Lever — Systems / Platform Engineer", company: "XM", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFdnVLKC1r1vKJ9xb2py09cAJbKK2ymydZFejQQ_AsGrxE23BTgItWRQrfzvrwEik7kYiRqaU7zPMEGzgl6hhGHr6S-DY5yDkowRtPp3oxP0WXZOQ4GUNXiqIpl5TCmFJvckn37frDQpzS2H5o9F3XtzIoKj1vz" },
  { portal: "Lever — Systems / Platform Engineer", company: "XM", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHqGMaDvXdk54gTjZX5WFQ0a6AcgtSCEKXmd_Fod3fZnuQw4Z2tMwFFLAnWizLheuLOadtpsOs44VPkpogh4V7n9S7Hxcq7yPe7NYIK1pncH-azwsWJyP5OPJlHKPSKncrneCUpvOx13GMOpmyW1IOufwvx2H9lICFImQpQRJi4__h24RtFF2PzQlj-74UJ-mqGljt6UhupKdDxf7_AqnGxJaF0WFe4Z68sL7g_csAxGKdYJ-MBClwXSR1tWl_-U8UQG-tt_eSEZBMB8beGupMLfrkOOsTmlQA0SgxT7b8pMuv2gVXsOdqRIqrnP_E-gweU-xrx4eQ=" },
  { portal: "Lever — Systems / Platform Engineer", company: "XM", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHJLXdLDS55HsLdPUZ_mf9mSki6QnD8W0RJk-9s2Bw6Tne1PIsKom1_JsOVk8iiEzSB3sfd0rAA1c6XWQK9ZDt92c9_aDC0AURIwcHXK-2zrR-mlfkWZ1w7DaswpDJPZ_nzevzxUeAB" },
  { portal: "Lever — Systems / Platform Engineer", company: "MARKT-PILOT GmbH", title: "(Senior) Platform Engineer (f/m/d)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFSoCVWNQepdVn47jFMNkKsQDHQPE_XmRiE0M7lNT681dn2YYqeIEzbiJ7-ggRVtkNVoN2YOE7AUTGFQHWOrqWJKJy7wkNOcankgGir1v1t5Qpo89QAE58OqAU=" },
  { portal: "Lever — Systems / Platform Engineer", company: "MARKT-PILOT GmbH", title: "(Senior) Platform Engineer (f/m/d)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGULLB77H24vd0jEuuG6PXIbe03DqP6Iy6OJLqlZY1oNDWmjXJB0MtzlkVfJKskQmIDnkC7Kq9i6w_fh_JTGq6fMaelwjz7Zdi2cUWsFEhCS4m0wRB7I_2QTCHx2vbi9cRONRzUB1Rq08bvlm3-ssc=" },

  // Query 13
  { portal: "Workable — Systems / Platform Engineer", company: "Rockstar", title: "Senior Platform Engineer - Integrations Platform", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQE3h36HuLBHLg5anesp5XcTJmiefZ9_k9LKNPAudxYrCAHPcEZEferKpPARolYtRJI59TpbvCZnlLmqPsyew7O74G5-bHIo-iFYEXbC-V9tjj2uwGzV0XY9NywwYQ==" },
  { portal: "Workable — Systems / Platform Engineer", company: "Burq, Inc.", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEU9hEmXnB7HFuobb4o6uieFL_TfR75jhoLUxezrMIVFQue-ibwn261aI8AuICHJh6tDZ4Aa3Aj97aqQssOFXfUV_FNnbeW02Db3t1RdeRKqRYShspVFmEKgJi6VXXKPuUC3g==" },
  { portal: "Workable — Systems / Platform Engineer", company: "LifeMD", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEISQSWrsaPhWd3AvhicNEqM4sV6B-77OiwUhzW_R-fDkIQ5zA5plIZ50Jj13se8ms6tiqYSCGuBlSQ10DE3CyNVtggubY-171PrVz8W6TBqS-BPeLNS0mp2Iklau6l1uiUsXr_TakCXLvD" },
  { portal: "Workable — Systems / Platform Engineer", company: "Sedona Digital", title: "Senior Platform DevOps Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGVGzUwLLEVgyOcxrCDhT22uoRHidGFrFFr77JZTiuvpcRXnFhDn6CHQolERJqo6pgumtbqE-vbTjEWNv1NZavtQxeVtNpA8tObynVQotz_OOZiOVyyppJmc8YcFiRrT1apb2W3ypwdFiVeaw==" },
  { portal: "Workable — Systems / Platform Engineer", company: "RecargaPay", title: "Senior Platform Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGaLmxWCeLmY3i3KNXxC7_aTc3gEcGMl5ux83hPo42aGURdu64I7zGD-9Rbtg5UNZF7zvj040tgVJfhWFcdMGhSKdVs4kaF3mOFpzzQjd-su8hOk2ekwt3wLW7WvEvp5O9QcMyP4b-0" },
  { portal: "Workable — Systems / Platform Engineer", company: "Rockstar", title: "Senior Platform Engineer - Data Platform", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGBErL4OXf67iuo7Trf1Fpp0CSuARwCH2cuBsklvoqwzr9piZ8g_bv8gVFwSTgeKLQKNA5p8LrhNGLQ3rukALWBmAG_8dVfDntd2csJx7zRWA-76YjjiY0Bh2Yev3Jllsofl5C_I5gnLQ==" },
  { portal: "Workable — Systems / Platform Engineer", company: "Mission Inbox", title: "Senior Systems Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEKBNwU-ixQKJV2Qih7UKK1Y1CvreFgWvu4prAhyXPABCe3Hq7zYCEahWA13ppNwCk1nR-kqXj-fAMlC7HYXPcfY9wkSAJxfr16oa7xwUfk9-EJdPz0J-rSybgM3JCuPnoh56mNjipJsNB7" },
  { portal: "Workable — Systems / Platform Engineer", company: "Systems Engineering Solutions Corporation", title: "Senior Systems Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG4nf0ve8AscE1JF3ezHY3bifRtz_L8zFjvox1651jx_-rdvMgZMprX7pwoXqOYyEln3X4n51kikga0xmFwYTsVK94rDflgcTqFhsU4xpOuWRFTmaSmcDqg2_l7l1p_Cq9mYnM5IhJcsutsVSh_VU-wmt0FMyPknJ-B0UDiw2-sbo_kMxJQ7PI=" },
  { portal: "Workable — Systems / Platform Engineer", company: "Dispel", title: "Senior Systems Engineer II (Edge Platform & Packaging)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG0h48ykrCigo3L_Qvh8BMi9RvVq84n8jkD_4ZM76-mP0ayK2XjCF_Rw4Tp8nZf1cH-7fcyu2eYLl_9YsPUfmB0lZdQ8V_jeh8-TFj4I5L1JdUJusW78thccZtglIh6RjH5tHs=" },
  { portal: "Workable — Systems / Platform Engineer", company: "GXA", title: "L4 Systems Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGtb0bSrEg8grpSBXQHvI53cyqQiO8gcv6_qVq2EqFRyonXWpy_lhJoMg6YPmGbdN40XMrBk1huL6p0x_WudJuiL41MvENZOaSh0B6MLWebqgSNUs4mP2zSrlkeJ4WmbGjzq-j1" },
  { portal: "Workable — Systems / Platform Engineer", company: "Zipdev", title: "Senior Systems Engineer (L3)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEHtoA38HbhfvV9ZiNiWQUi32WksZjo0N9xnPi_HTp_SM-0Me9vFfxUvp1L-k085BMmo1U-ciKCLGwWivDq_pNXlIz2GGktaNWBoCeSmypD6raXzW99a-BjKaK0-T20m9utTRU=" },

  // Query 14
  { portal: "Ashby — Forward Deployed Engineer", company: "Camunda", title: "AI Process Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHGXvU3G-QLKkUrhYn665sPpAUrSDsMWgdb3WNrjGojQndbDRcKCyfhR9B5YvXfCSMWqcvh2lMzeu2fQ7XbJkoDSH7I-vdpWT4gfmQ4aiEAuV4eGmsEKmONPArCeRQ7jtD3p3uq8gY7S8rfQN8xJs4cIi1lXCvZD7UTgVE=" },
  { portal: "Ashby — Forward Deployed Engineer", company: "Doppel", title: "Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQG3n7y5UOuqLfAKnZqt93C9_OELfpWuEt69lynCT-yLZQjnA8ryKZ2sBW18UdGSvxfgHhoLhXzFlN7CsH5tV_j41-g6ltslaovTb9Z2RwBupjM_xR-eYc8QFM5VOEK7cxImhkldGY75j8eLsAy5ELQMtfRNwh7nRLbPWw==" },
  { portal: "Ashby — Forward Deployed Engineer", company: "Level AI (Ujwal Inc.)", title: "Forward Deployed Engineer - Agents", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEWgkXAg3AYXoRXbStPhXUlM3tHz1h9HX-_3ex-fnVmOrp4J-5GJXZr5fpCbk51h4NVi6tnUdzX__vxm0HzeokX1SjQgM3ksAqL-ETQuDGNFLoaGFPJt7zR5ZqRzfYcBBJkJTlfIDBLcYsOYGW00OC_4aQ7LoASu2OTcI2_" },
  { portal: "Ashby — Forward Deployed Engineer", company: "Protege", title: "Forward Deployed Engineer, Healthcare", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEKEz9MJASZwru5YcJw-Brs755KDbO6Um3vi79bYaXEv2v6eAhWiKMniQNgokqhaKl0is_xgDBYQQA1opjtjrsRLn99NYQGJJxyrTlJkvrwcJa-ojUKNmDCox5-M_ETDOb1yuYuWN4gBIrJm-FKm50dy6Urhr99gvC6glw=" },
  { portal: "Ashby — Forward Deployed Engineer", company: "Maybern", title: "Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHRlXurzsP1K_HAMzeJOlunylnA9v8bHPXlq_I3BfUJ1AP7rr2sZfHUCftLgKCc5TW3-DrI4InCufwFF5LST74KSRYgkYDtAg2EwZet-HPcMIxFpLYLT8lPUuqb5Tl9xkydpbmWKqwA2L4zcNX9WnloEVkyOp0MUDMm3N0=" },
  { portal: "Ashby — Forward Deployed Engineer", company: "Realm", title: "Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFuZC9qeCEZs1n_aYufxFxrKVmSmyXDGEvkWNA36oJqQZAwPUEWI3ZSxi2iQgxs1JjM03ASROuP9senBbVSmDbJumxzHV6xLagNpypUnMdh1ALwRdmpz4GypVOuoEtQ6mrCY3CLIt-kRuYErbtddE26an88yeXSf4GhArgBMXOpQKY=" },
  { portal: "Ashby — Forward Deployed Engineer", company: "LiveKit", title: "Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGLQBmlvxp42JSYtZ_1qm9E6bDDpcNZ0POOJDv6RoCkzg1hD8h5XJ0v6bpzM9dqFMYIaShF9Wlv1elhy-JczAojLsTXHwxkaLcS0XG4Y0LuNugp7T3qklosD-6UHvltTWq3HXlCzw1QWFp8ShrlxK-w6xeUyPdTd9OV9Rw=" },
  { portal: "Ashby — Forward Deployed Engineer", company: "Runpod", title: "Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQH84WhnmysLKnQ6dDjrkjk7kawNyWNYwsdXRK55YYtTtratF_As6N9rhinZMJHttKxqoOM0WlaIVJuhKGKwSb8GGYGrg8oM025-aih4hePB8QUc1Kx-lNfNg7afUwUUTdy7NQYR1GAC1tIdEbPDSqmKQMEZhPteW7M_Sg==" },

  // Query 15
  { portal: "Greenhouse — Forward Deployed Engineer", company: "Glean", title: "Founding Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEGxfA6Q2SFxDdjcuShtbmg8_7JU7kmiJyDkbTa2qdZdZb0Pw6qvvv0G9UuSQReMY_4jI3NzrCoYFNNpPn8if1V06aAtwcOr3mt2xsWHf_nGLpvhyy-HmeYR6DF3ZLnnaC-cvxud1oe566I54t4mjxD" },
  { portal: "Greenhouse — Forward Deployed Engineer", company: "GitLab", title: "Forward Deployed Engineer - EMEA", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHMKR6zWF8INQk0_mE4b21JuJASpey_AnULcEzQmifdgZa1_tmzH3YJ-KT4yYr6usBX3lZUr0g8Q-T98wh9YhKpLsW0eq5jwfEN36Z3IuNKnJNASWxWIT6YO6t66Hrcr5zBRNzzI7toWjfIODlA" },
  { portal: "Greenhouse — Forward Deployed Engineer", company: "Sixfold", title: "Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGatZej4S82T1nawfLbReOr4TrDi3_f9BEdFAxjM0TBSIn-Akw8Ln1wfpfYYLHXfFn7UbVVr9VvxeKPxMheBgnXxScv9857kIYXQPSKSilS3BdtM-EvEj5J2X0MLNchnu6urnWTiXtgYaV-tv91mw==" },
  { portal: "Greenhouse — Forward Deployed Engineer", company: "Striim, Inc.", title: "Forward Deployed Engineer (FDE)", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFcTF_RX7RCfPbuiJWig1qLipry6hgLmTesbxf1tNHs6HPXf42AaAb9U_dNcJkeJ6aeSCLZPFCMERbYOFX9169eqUtXGW0La7z92sBD6BjC1eCDNmGYAFr7arna_GsDy2FJ5_M_thAXbfnfY_0hAwMj" },
  { portal: "Greenhouse — Forward Deployed Engineer", company: "Canopy Connect", title: "Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQF0uTWnw4cFCS-IxCOspbTAl7FMy-7gackiJRsLFtPcZzcgO3jIh5h_12DaYKtTpy8bYiq9WZ2md5H8XdJoijt__vHsY9osqP3V6fPm_FfGPIEFFE5vf50oquMfaAHmvFDIHlGsL1PIrkEbVVEMAV5BCXbPbA==" },
  { portal: "Greenhouse — Forward Deployed Engineer", company: "Nearform", title: "Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGUcIM-_heqfaC3TAlSYXzvzlrHjHJPCKL6gJmVzTPIEzoVoysHW510pAKuYTEEzhTvR_6lNLZEpXFtFN2pRpfzfjMFfzNnt_mPOjh6h6zXjJO7jrhSxRq60ESwTncHF6rSgNZX7ppcayJ9CjqHae0=" },
  { portal: "Greenhouse — Forward Deployed Engineer", company: "Venn", title: "Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGs393fwi3XdvXrhqIeVGxOA04eG7_WNDeo4_aM9B6AbZV95WrBapcF8vb1_5TUBSITrKktGnhzRCyegEWDxGCCY8641QAXqRms3txMlEF_7RPTSZz0j3NlK4GoBra6tSXOWpwJHcJ7onI" },
  { portal: "Greenhouse — Forward Deployed Engineer", company: "Venn", title: "Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGhdhoKroaQEnP6mLR7Bn_a6JFkGNWqYlcvJ7GPdhKpQVQbBumATVA5cPQqup8NdxFeOSVmeO5Anzh7tQgETqJZtxyJNq8nt5QUOh10vQaUiz3P2AP6NcT2VNdVM--Q76VorOg9Mycl5rUH6-WTN9c=" },
  { portal: "Greenhouse — Forward Deployed Engineer", company: "Domino Data Lab", title: "Forward Deployed Engineer, Life Sciences", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQELIhNLD0QxsvBoaJrMvucDF58RJWq8R39hijSEW1uRPDh4kMTdiYy1oTDkapHS0-jBsZjzyGg2R81gIakpA972WHvAlg6cVjUrefOiblxjn0RZhBLG6zfEerH503z_Ez1zX5naHb16P-nOExXw" },
  { portal: "Greenhouse — Forward Deployed Engineer", company: "Domino Data Lab", title: "Forward Deployed Engineer, Life Sciences", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFDfd6pLbpr5lKwIcRNp5jktMh4m6MpFX_mtJkQ3wm2wss3k09FHGJfFOdMzADG4_IrF07QAOIMbVZqBulP7jJBum9i-8AOUPoMJUkcD3nFq3exmmhh34LRzGSi5pE5no7lm3ecU6-HJw0GDBCa" },
  { portal: "Greenhouse — Forward Deployed Engineer", company: "Federato", title: "Senior Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGTEsT10PWF0bvJo2Af3UuRaN2trXUedtU5wHQndHgo5AOXYSn9k_5hR0O6I4mPDsZhwrP-a3dXMfLWaoNV_H4x5v1h0b6nS0gu9Db_y-50pW8oBL_nWAnHZ2B3XpEa-HeV9luYWoAuzzw1yQ==" },
  { portal: "Greenhouse — Forward Deployed Engineer", company: "Clariti Cloud Inc.", title: "Forward Deployed Engineer", rawUrl: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHsg2FgygVJxSgkJ7dzHwVttIDWOhCzIm3CJqQam8ABRBQGSZizSF3-YCrbHMG-z7ZsM2oq27A0RuyRTg_0KOauIbJMURPjL0ilnY28ERX8pUCdbaRDxGWSD3tPTcyViV4eilmKKsxrmM1Ut2FfxL6d5tU=" }
];

async function resolveUrl(url) {
  const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': userAgent } });
    return res.url;
  } catch (e) {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'user-agent': userAgent } });
      return res.url;
    } catch (err) {
      console.warn(`Failed to resolve redirect for ${url}: ${err.message}`);
      return url;
    }
  }
}

// Helper to escape values for TSV
function sanitizeTsvField(value) {
  const str = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return /^[=+\-@]/.test(str) ? `'${str}` : str;
}

// Compile keyword matcher (from scan.mjs)
function compileKeyword(kw) {
  if (/^[a-z]{2,3}$/.test(kw)) {
    const re = new RegExp(`\\b${kw}\\b`);
    return (lower) => re.test(lower);
  }
  return (lower) => lower.includes(kw);
}

function buildTitleFilter(titleFilter) {
  const normalize = (arr) => (Array.isArray(arr) ? arr : [])
    .filter(k => typeof k === 'string')
    .map(k => k.trim().toLowerCase())
    .filter(k => k.length > 0)
    .map(compileKeyword);
  const positive = normalize(titleFilter?.positive);
  const negative = normalize(titleFilter?.negative);

  return (title) => {
    const lower = (title || '').toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(m => m(lower));
    const hasNegative = negative.some(m => m(lower));
    return hasPositive && !hasNegative;
  };
}

function buildLocationFilter(locationFilter) {
  if (!locationFilter) return () => true;
  const normalizeList = (value) => {
    if (value == null) return [];
    const arr = Array.isArray(value) ? value : [value];
    return arr.filter(k => typeof k === 'string').map(k => k.toLowerCase().trim()).filter(Boolean);
  };
  const alwaysAllow = normalizeList(locationFilter.always_allow);
  const allow = normalizeList(locationFilter.allow);
  const block = normalizeList(locationFilter.block);

  return (location) => {
    if (typeof location !== 'string' || location.trim() === '') return true;
    const lower = location.toLowerCase();
    if (alwaysAllow.length > 0 && alwaysAllow.some(k => lower.includes(k))) return true;
    if (block.length > 0 && block.some(k => lower.includes(k))) return false;
    if (allow.length === 0) return true;
    return allow.some(k => lower.includes(k));
  };
}

// Greenhouse API fetcher
async function fetchGreenhouseMetadata(board, jobId) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}`);
    if (res.status === 200) {
      const data = await res.json();
      return {
        title: data.title,
        location: data.location?.name || '',
      };
    }
  } catch (e) {
    // ignore
  }
  return null;
}

// Lever API fetcher
async function fetchLeverMetadata(slug, jobId) {
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${slug}/${jobId}`);
    if (res.status === 200) {
      const data = await res.json();
      return {
        title: data.text,
        location: data.categories?.location || '',
      };
    }
  } catch (e) {
    // ignore
  }
  return null;
}

async function main() {
  console.log(`Resolving ${rawCandidates.length} raw redirect URLs...`);
  
  // Deduplicate raw urls
  const uniqueRawCandidates = [];
  const seenRaw = new Set();
  for (const c of rawCandidates) {
    if (!seenRaw.has(c.rawUrl)) {
      seenRaw.add(c.rawUrl);
      uniqueRawCandidates.push(c);
    }
  }
  console.log(`Unique raw candidates: ${uniqueRawCandidates.length}`);

  // Resolve all URLs
  const resolvedCandidates = [];
  for (const c of uniqueRawCandidates) {
    const resolvedUrl = await resolveUrl(c.rawUrl);
    resolvedCandidates.push({
      ...c,
      url: resolvedUrl
    });
  }

  // Load configuration
  const portalsConfig = yaml.load(fs.readFileSync('portals.yml', 'utf-8'));
  const titleFilter = buildTitleFilter(portalsConfig.title_filter);
  const locationFilter = buildLocationFilter(portalsConfig.location_filter);

  // Load existing data for deduplication
  const seenUrls = new Set();

  if (fs.existsSync('data/scan-history.tsv')) {
    const text = fs.readFileSync('data/scan-history.tsv', 'utf-8');
    const lines = text.split('\n');
    for (const line of lines.slice(1)) {
      const [url] = line.split('\t');
      if (url) seenUrls.add(url.trim());
    }
  }

  if (fs.existsSync('data/pipeline.md')) {
    const text = fs.readFileSync('data/pipeline.md', 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seenUrls.add(match[1].trim());
    }
  }

  if (fs.existsSync('data/applications.md')) {
    const text = fs.readFileSync('data/applications.md', 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seenUrls.add(match[0].trim());
    }
  }

  console.log(`Loaded ${seenUrls.size} already seen URLs for deduplication.`);

  // We skip company names matches for local_parser_ok
  const localParserOk = new Set(['gitlab', 'anthropic', 'spotify']);

  const pendingWrite = [];
  let skippedDupCount = 0;
  let skippedTitleCount = 0;
  let skippedLocationCount = 0;
  let skippedCompanyOkCount = 0;

  const tsvLinesToAppend = [];

  for (const c of resolvedCandidates) {
    // 1. Skip if normalized company matches local_parser_ok
    const normCompany = c.company.toLowerCase();
    if (localParserOk.has(normCompany)) {
      console.log(`Skipping ${c.company} | ${c.title} because company is resolved by zero-token scan.`);
      skippedCompanyOkCount++;
      continue;
    }

    // 2. Check deduplication
    if (seenUrls.has(c.url)) {
      console.log(`Duplicate URL: ${c.url} (${c.company} | ${c.title})`);
      // check if it's already in scan-history.tsv to avoid writing duplicate skipped_dup rows
      let alreadyInTsv = false;
      if (fs.existsSync('data/scan-history.tsv')) {
        const tsvText = fs.readFileSync('data/scan-history.tsv', 'utf-8');
        if (tsvText.includes(c.url)) {
          alreadyInTsv = true;
        }
      }
      if (!alreadyInTsv) {
        tsvLinesToAppend.push({
          url: c.url,
          portal: c.portal,
          title: c.title,
          company: c.company,
          status: 'skipped_dup',
          location: ''
        });
      }
      skippedDupCount++;
      continue;
    }

    // 3. Fetch structured API metadata if Greenhouse/Lever to get exact title and location
    let finalTitle = c.title;
    let finalLocation = '';

    // Check Greenhouse
    let ghMatch = c.url.match(/(?:boards|job-boards)\.(?:eu\.)?greenhouse\.io\/([^/]+)\/jobs\/(\d+)/);
    if (ghMatch) {
      const meta = await fetchGreenhouseMetadata(ghMatch[1], ghMatch[2]);
      if (meta) {
        finalTitle = meta.title;
        finalLocation = meta.location;
        console.log(`Greenhouse API metadata resolved: ${finalTitle} (${finalLocation})`);
      }
    }

    // Check Lever
    let leverMatch = c.url.match(/jobs\.(?:eu\.)?lever\.co\/([^/]+)\/([^/?#]+)/);
    if (leverMatch) {
      const meta = await fetchLeverMetadata(leverMatch[1], leverMatch[2]);
      if (meta) {
        finalTitle = meta.title;
        finalLocation = meta.location;
        console.log(`Lever API metadata resolved: ${finalTitle} (${finalLocation})`);
      }
    }

    // 4. Apply title_filter
    if (!titleFilter(finalTitle)) {
      console.log(`Title filtered out: "${finalTitle}" (${c.company})`);
      tsvLinesToAppend.push({
        url: c.url,
        portal: c.portal,
        title: finalTitle,
        company: c.company,
        status: 'skipped_title',
        location: finalLocation
      });
      skippedTitleCount++;
      continue;
    }

    // 5. Apply location_filter
    if (!locationFilter(finalLocation)) {
      console.log(`Location filtered out: "${finalLocation}" for "${finalTitle}" (${c.company})`);
      tsvLinesToAppend.push({
        url: c.url,
        portal: c.portal,
        title: finalTitle,
        company: c.company,
        status: 'skipped_location',
        location: finalLocation
      });
      skippedLocationCount++;
      continue;
    }

    // Passed title + location filters. Now collect for liveness check.
    pendingWrite.push({
      url: c.url,
      portal: c.portal,
      title: finalTitle,
      company: c.company,
      location: finalLocation
    });
  }

  console.log(`\nFiltered Candidates:`);
  console.log(`- Resolved company (Ok) skipped: ${skippedCompanyOkCount}`);
  console.log(`- Duplicate skipped: ${skippedDupCount}`);
  console.log(`- Title filtered skipped: ${skippedTitleCount}`);
  console.log(`- Location filtered skipped: ${skippedLocationCount}`);
  console.log(`- Surviving to liveness check: ${pendingWrite.length}`);

  if (pendingWrite.length === 0) {
    console.log("No new offers survived filtering.");
    appendAllToScanHistory(tsvLinesToAppend);
    console.log("Done.");
    process.exit(0);
  }

  // 6. Check Liveness of surviving URLs
  console.log("\nRunning check-liveness.mjs on surviving candidates...");
  const urlsToCheck = pendingWrite.map(o => o.url);
  
  let livenessStdout = '';
  try {
    const cmd = `node check-liveness.mjs --no-fallback ${urlsToCheck.map(u => `"${u}"`).join(' ')}`;
    console.log(`Running: ${cmd}`);
    livenessStdout = execSync(cmd, { encoding: 'utf-8' });
  } catch (err) {
    livenessStdout = err.stdout || '';
  }

  console.log("Liveness check output:\n", livenessStdout);

  const activeUrls = new Set();
  const expiredUrls = new Set();
  const uncertainUrls = new Set();

  const lines = livenessStdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('✅ active')) {
      const url = trimmed.substring(trimmed.lastIndexOf('https://')).trim();
      activeUrls.add(url);
    } else if (trimmed.startsWith('❌ expired')) {
      const url = trimmed.substring(trimmed.lastIndexOf('https://')).trim();
      expiredUrls.add(url);
    } else if (trimmed.startsWith('⚠️ uncertain')) {
      const url = trimmed.substring(trimmed.lastIndexOf('https://')).trim();
      uncertainUrls.add(url);
    }
  }

  let newlyAddedCount = 0;
  let skippedExpiredCount = 0;

  const pipelineLines = [];

  for (const o of pendingWrite) {
    if (activeUrls.has(o.url)) {
      console.log(`ACTIVE: Adding ${o.company} | ${o.title}`);
      pipelineLines.push(`- [ ] ${o.url} | ${o.company} | ${o.title}`);
      tsvLinesToAppend.push({
        url: o.url,
        portal: o.portal,
        title: o.title,
        company: o.company,
        status: 'added',
        location: o.location
      });
      newlyAddedCount++;
    } else {
      console.log(`INACTIVE (${expiredUrls.has(o.url) ? 'expired' : 'uncertain/failed'}): Skipping ${o.company} | ${o.title}`);
      tsvLinesToAppend.push({
        url: o.url,
        portal: o.portal,
        title: o.title,
        company: o.company,
        status: 'skipped_expired',
        location: o.location
      });
      skippedExpiredCount++;
    }
  }

  // Write newly added to data/pipeline.md
  if (pipelineLines.length > 0) {
    const pipelinePath = 'data/pipeline.md';
    let pipelineText = fs.readFileSync(pipelinePath, 'utf-8');
    
    const processedIndex = pipelineText.indexOf('## Processed');
    if (processedIndex !== -1) {
      const beforeProcessed = pipelineText.substring(0, processedIndex);
      const afterProcessed = pipelineText.substring(processedIndex);
      
      const newPipelineText = beforeProcessed + pipelineLines.join('\n') + '\n\n' + afterProcessed;
      fs.writeFileSync(pipelinePath, newPipelineText, 'utf-8');
      console.log(`Appended ${pipelineLines.length} roles to data/pipeline.md`);
    } else {
      fs.appendFileSync(pipelinePath, '\n' + pipelineLines.join('\n') + '\n', 'utf-8');
      console.log(`Appended ${pipelineLines.length} roles to end of data/pipeline.md`);
    }
  }

  // Append all to scan history
  appendAllToScanHistory(tsvLinesToAppend);

  console.log(`\nExecution finished:`);
  console.log(`- Added: ${newlyAddedCount}`);
  console.log(`- Expired/Uncertain skipped: ${skippedExpiredCount}`);
}

function appendAllToScanHistory(items) {
  if (items.length === 0) return;
  const date = '2026-08-13';
  const filepath = 'data/scan-history.tsv';
  
  if (!fs.existsSync(filepath)) {
    fs.writeFileSync(filepath, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n', 'utf-8');
  }

  const lines = items.map(o => {
    return [
      o.url,
      date,
      o.portal,
      o.title,
      o.company,
      o.status,
      o.location || '',
      '', // jd_fingerprint
      ''  // postedAt
    ].map(sanitizeTsvField).join('\t');
  }).join('\n') + '\n';

  fs.appendFileSync(filepath, lines, 'utf-8');
  console.log(`Appended ${items.length} rows to data/scan-history.tsv`);
}

main().catch(err => {
  console.error("Error in process script:", err);
});
